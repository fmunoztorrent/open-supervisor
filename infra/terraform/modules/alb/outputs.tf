output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID for Route53 alias records"
  value       = aws_lb.main.zone_id
}

output "alb_arn" {
  value = aws_lb.main.arn
}

output "alb_sg_id" {
  value = aws_security_group.alb.id
}

output "bff_target_group_arn" {
  value = aws_lb_target_group.bff.arn
}

output "sse_target_group_arn" {
  value = aws_lb_target_group.sse.arn
}

output "auth_target_group_arn" {
  value = aws_lb_target_group.auth.arn
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}
