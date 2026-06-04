output "cluster_arn" {
  description = <<-EOT
    MSK Serverless cluster ARN.
    Bootstrap brokers are NOT available as a Terraform attribute for serverless clusters.
    After apply, retrieve them with:
      aws kafka get-bootstrap-brokers --cluster-arn <cluster_arn>
    Then set var.kafka_bootstrap_brokers and re-apply (or store in SSM and reference from ECS).
  EOT
  value = aws_msk_serverless_cluster.main.arn
}

output "cluster_uuid" {
  value = aws_msk_serverless_cluster.main.cluster_uuid
}
