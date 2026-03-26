# ==============================================================================
# Facetime — AWS Infrastructure
# ==============================================================================
# Resources provisioned:
#   - VPC + public subnet + internet gateway
#   - Security group (SSH + App ports + WebRTC UDP range)
#   - Elastic IP (static public IP for Mediasoup config)
#   - EC2 instance with a startup script to bootstrap the app
# ==============================================================================

# ── Data Sources ───────────────────────────────────────────────────────────────

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── VPC & Networking ───────────────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${var.project_name}-vpc"
    Environment = var.environment
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name        = "${var.project_name}-public-subnet"
    Environment = var.environment
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ── Security Group ─────────────────────────────────────────────────────────────

resource "aws_security_group" "app" {
  name        = "${var.project_name}-sg"
  description = "Facetime SFU security group"
  vpc_id      = aws_vpc.main.id

  # SSH
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  # Next.js frontend (HTTP default port)
  ingress {
    description = "Frontend UI"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Node.js / Mediasoup WebSocket signaling
  ingress {
    description = "WebSocket Signaling"
    from_port   = 4000
    to_port     = 4000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Mediasoup WebRTC UDP media stream ports
  ingress {
    description = "WebRTC UDP (Mediasoup)"
    from_port   = 40000
    to_port     = 49999
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Allow all outbound
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-sg"
    Environment = var.environment
  }
}

# ── Static Elastic IP ──────────────────────────────────────────────────────────
# IMPORTANT: Mediasoup must be configured with a fixed Public IP.
# Using an Elastic IP guarantees the IP stays the same across instance restarts.

resource "aws_eip" "app" {
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-eip"
  }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

# ── Cloudflare DNS ─────────────────────────────────────────────────────────────
# yuchia.dev is managed in Cloudflare. This record points the chosen subdomain
# (or apex "@") at the EC2 Elastic IP.
# proxied = true  → traffic routes through Cloudflare CDN/WAF (hides real IP)
# proxied = false → plain DNS, needed for raw WebSocket/WebRTC on non-standard ports

locals {
  # Build the display FQDN (used in outputs only)
  fqdn = var.subdomain == "@" ? var.domain_name : "${var.subdomain}.${var.domain_name}"
}

resource "cloudflare_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = var.subdomain # "@" = apex, "facetime" = facetime.yuchia.dev, etc.
  content = aws_eip.app.public_ip
  type    = "A"
  proxied = true # Required for HTTPS Edge Certificates in Cloudflare
}

# ── EC2 Instance ───────────────────────────────────────────────────────────────

# 1. Generate a new private key
resource "tls_private_key" "facetime_key" {
  algorithm = "ED25519"
}

# 2. Create the AWS Key Pair using that generated public key
resource "aws_key_pair" "facetime" {
  key_name   = "facetime"
  public_key = tls_private_key.facetime_key.public_key_openssh
}

# 3. Optional: Save the private key to a local file so you can use it to SSH
resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.facetime_key.private_key_openssh
  filename        = "${path.module}/facetime.pem"
  file_permission = "0600"
}

# ── IAM: EC2 Instance Profile (for SSM) ────────────────────────────────────────

resource "aws_iam_role" "ec2_ssm_role" {
  name = "${var.project_name}-ec2-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

# Attach the AWS-managed policy that allows SSM agent to communicate with the service
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2_ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_ssm_profile" {
  name = "${var.project_name}-ec2-ssm-profile"
  role = aws_iam_role.ec2_ssm_role.name
}

# ── IAM: GitHub OIDC Provider & Actions Role ───────────────────────────────────

# 1. Register GitHub as an OIDC identity provider in AWS
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # Official AWS/GitHub thumbprints for the OIDC provider
  thumbprint_list = ["1c58a3a8518e8759bf075b76b750d4f2df264fcd", "6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# 2. Create the Role that GitHub Actions will assume
resource "aws_iam_role" "github_actions_role" {
  name = "${var.project_name}-github-actions-deploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Condition = {
          StringLike = {
            "token.actions.githubusercontent.com:sub" : "repo:yuchia329/facetime:*" # replace yuchia329 with your github username
          }
          StringEquals = {
            "token.actions.githubusercontent.com:aud" : "sts.amazonaws.com"
          }
        }
      }
    ]
  })
}

# 3. Grant the GitHub Actions Role permission to run SSM commands on your specific EC2 instance
resource "aws_iam_policy" "github_ssm_policy" {
  name        = "${var.project_name}-github-ssm-policy"
  description = "Allow GitHub Actions to run SSM commands on the app instance"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:SendCommand"
        ]
        Resource = [
          "arn:aws:ssm:*:*:document/AWS-RunShellScript",
          aws_instance.app.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetCommandInvocation"
        ]
        Resource = [
          aws_instance.app.arn,
          "arn:aws:ssm:*:*:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_ssm_attach" {
  role       = aws_iam_role.github_actions_role.name
  policy_arn = aws_iam_policy.github_ssm_policy.arn
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = var.key_pair_name

  # 1. ADD THIS: Attach the IAM profile so SSM works
  iam_instance_profile = aws_iam_instance_profile.ec2_ssm_profile.name

  root_block_device {
    volume_size = 30 # GB — extra headroom for Docker image layers + build cache
    volume_type = "gp3"
  }

  user_data = <<-EOF
    #!/bin/bash
    set -e
    export DEBIAN_FRONTEND=noninteractive
    export NEEDRESTART_MODE=a
    exec > >(tee /var/log/facetime-init.log | logger -t user-data -s 2>/dev/console) 2>&1

    echo "[1/4] Installing system packages..."
    apt-get update -y
    apt-get install -y curl ca-certificates gnupg lsb-release

    echo "[2/4] Starting SSM Agent..."
    snap install amazon-ssm-agent --classic
    systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service

    echo "[3/4] Installing Docker Engine..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    usermod -aG docker ubuntu

    echo "[4/4] Setting up persistent application configuration..."
    mkdir -p /opt/facetime
    cd /opt/facetime

    # Write the docker-compose file
    cat > docker-compose.prod.yml <<'COMPOSEEOF'
    services:
      server:
        image: $${SERVER_IMAGE}
        restart: always
        network_mode: host
        security_opt:
          - seccomp:unconfined
        env_file: .env.prod
        logging:
          driver: "json-file"
          options:
            max-size: "10m"
            max-file: "3"

      client:
        image: $${CLIENT_IMAGE}
        restart: always
        ports:
          - "80:3000"
        environment:
          - BACKEND_URL=http://server:4000
        env_file: .env.prod
        extra_hosts:
          - "server:host-gateway"
        depends_on:
          - server
        logging:
          driver: "json-file"
          options:
            max-size: "10m"
            max-file: "3"
COMPOSEEOF

    # ------------------------------------------------------------------------------
    # CREATE THE PER-BOOT SCRIPT
    # Everything below this line will execute on EVERY boot, reboot, or stop/start
    # ------------------------------------------------------------------------------
    cat > /var/lib/cloud/scripts/per-boot/01-start-facetime.sh <<'BOOTEOF'
    #!/bin/bash
    exec > >(tee /var/log/facetime-per-boot.log | logger -t per-boot -s 2>/dev/console) 2>&1
    echo "Running per-boot startup script..."

    cd /opt/facetime

   # 1. Fetch metadata fresh on every boot for Mediasoup's WebRTC announcedIp
    TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" -s)
    PUBLIC_IP=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/public-ipv4)

    # 2. Re-write the .env file mixing the hardcoded domain and dynamic IP
    cat > .env.prod <<ENVEOF
    # Required by Mediasoup for WebRtcTransport
    PUBLIC_IP=$PUBLIC_IP 
    MEDIASOUP_ANNOUNCED_IP=$PUBLIC_IP
    
    # Used by the frontend and clients
    BACKEND_URL=http://server:4000
    
    CLIENT_ORIGIN=https://${local.fqdn}
    
    # Docker configuration (defaults, will be replaced by GitHub Actions)
    CLIENT_IMAGE=yuchia329/facetime-client:latest #REPLACE THIS with your DockerHub repository
    SERVER_IMAGE=yuchia329/facetime-server:latest #REPLACE THIS with your DockerHub repository
ENVEOF

    # 3. Pull the absolute latest image from Docker Hub and start the container
    docker compose -f docker-compose.prod.yml --env-file .env.prod pull
    docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
BOOTEOF

    # Make the per-boot script executable
    chmod +x /var/lib/cloud/scripts/per-boot/01-start-facetime.sh

    # Execute it manually right now to handle the very first boot
    /var/lib/cloud/scripts/per-boot/01-start-facetime.sh

    echo "Facetime server initialization complete."
  EOF

  tags = {
    Name        = "${var.project_name}-server"
    Environment = var.environment
  }
}

