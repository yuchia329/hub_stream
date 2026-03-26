variable "aws_region" {
  description = "AWS region to deploy resources in"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name prefix applied to all created resources"
  type        = string
  default     = "facetime"
}

variable "environment" {
  description = "Deployment environment (e.g. production, staging)"
  type        = string
  default     = "production"
}

# ── EC2 ────────────────────────────────────────────────────────────────────────

variable "instance_type" {
  description = "EC2 instance type for the SFU+frontend server"
  type        = string
  default     = "t4g.medium" # Graviton2 ARM — up to 40% cheaper than t3 equivalent
  # ARM options by price: t4g.small (~$12/mo) | t4g.medium (~$24/mo) | t4g.large (~$48/mo)
  # ⚠️  Must match the ARM64 architecture. Do NOT mix with x86 AMIs.
}

variable "ami_id" {
  description = "AMI ID to launch — must be ARM64 for t4g instances (Ubuntu 22.04 LTS ARM)"
  type        = string
  # Find the latest Ubuntu 22.04 ARM64 AMI in your region:
  # aws ec2 describe-images --owners 099720109477 \
  #   --filters 'Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64*' \
  #   --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  #   --region us-east-1
  default = "ami-0d71ea30463e0ff49" # us-east-1 Ubuntu 22.04 LTS ARM64
}

variable "key_pair_name" {
  description = "Name of an existing EC2 Key Pair to enable SSH access"
  type        = string
  # Create with: ssh-keygen -t rsa -b 4096 -f ~/.ssh/facetime
  # Then import to AWS: aws ec2 import-key-pair --key-name facetime --public-key-material fileb://~/.ssh/facetime.pub
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed to SSH into the instance (your home/office IP)"
  type        = string
  default     = "0.0.0.0/0" # Restrict this to your IP in production!
}

# ── Cloudflare DNS ───────────────────────────────────────────────────────────────

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS:Edit permission for the zone"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Zone ID of yuchia.dev in Cloudflare (Dashboard → Overview → right sidebar)"
  type        = string
}

variable "domain_name" {
  description = "Root domain managed in Cloudflare (e.g. 'yuchia.dev')"
  type        = string
  default     = "yuchia.dev"
}

variable "subdomain" {
  description = "Subdomain for the A record ('facetime' → facetime.yuchia.dev, '@' → apex yuchia.dev)"
  type        = string
  default     = "facetime"
}
