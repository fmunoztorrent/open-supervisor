# ── ALB Security Group ────────────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-${var.environment}-alb"
  description = "Internet-facing ALB — allow HTTP/HTTPS from anywhere"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP (redirected to HTTPS)"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound to ECS tasks"
  }

  tags = { Name = "${var.project_name}-${var.environment}-alb-sg" }
}

# ── Application Load Balancer ─────────────────────────────────────────────────
resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  # SSE long-lived connections require a high idle timeout.
  # The mobile app holds SSE connections open; 3600s matches NestJS @Sse() behavior.
  idle_timeout               = 3600
  enable_deletion_protection = var.environment == "prod"

  tags = { Name = "${var.project_name}-${var.environment}-alb" }
}

# ── Listeners ─────────────────────────────────────────────────────────────────
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  # Default route: BFF handles REST + proxied SSE for the mobile app
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.bff.arn
  }
}

# ── Target Groups ─────────────────────────────────────────────────────────────
resource "aws_lb_target_group" "bff" {
  name        = "${var.project_name}-${var.environment}-bff"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = { Name = "${var.project_name}-${var.environment}-tg-bff" }
}

resource "aws_lb_target_group" "sse" {
  name        = "${var.project_name}-${var.environment}-sse"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  # Slow deregistration: SSE tasks may have active long-lived connections
  deregistration_delay = 300

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = { Name = "${var.project_name}-${var.environment}-tg-sse" }
}

resource "aws_lb_target_group" "auth" {
  name        = "${var.project_name}-${var.environment}-auth"
  port        = 3002
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = { Name = "${var.project_name}-${var.environment}-tg-auth" }
}

# ── Path-based Listener Rules ─────────────────────────────────────────────────
# Priority 10: /sse/* → sse-server (BFF proxies SSE internally; expose directly only if needed)
resource "aws_lb_listener_rule" "sse" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sse.arn
  }

  condition {
    path_pattern { values = ["/sse/*"] }
  }
}

# Priority 20: /internal/* → authorization-service (admin/internal endpoints)
resource "aws_lb_listener_rule" "auth" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.auth.arn
  }

  condition {
    path_pattern { values = ["/internal/*"] }
  }
}
