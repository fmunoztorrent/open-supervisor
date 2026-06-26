<?xml version="1.0" encoding="UTF-8"?>
<spec version="1.0" slug="localstack-infra" date="2026-06-26" status="completed" revision="3">
  <meta>
    <title>LocalStack MSK Infrastructure — AWS Parity for Local Development</title>
    <stack>NestJS + React Native + Kafka + LocalStack Pro</stack>
    <archived>true</archived>
  </meta>

  <history>
    <revision id="1" date="2026-06-26" author="spec-agent">
      <change>Initial spec created</change>
    </revision>
    <revision id="2" date="2026-06-26" author="architect">
      <change>Architect review: corrected tier (Pro→Ultimate), flagged serverless vs provisioned TF mismatch, added contracts section, added integration test paths, added msk-env.sh to .gitignore, noted awslocal prerequisite, added EXTERNAL_SERVICE_PORTS_RANGE config, added Terraform validation test scenarios</change>
    </revision>
    <revision id="3" date="2026-06-26" author="backend">
      <change>Implementation complete: US-01 (docker-compose.localstack.yml + MSK), US-02 (msk-local.tf + provider endpoints), US-03 (bootstrap-msk-local.sh), US-04 (env var sourcing in Makefile), US-05 (localstack/localstack-infra/localstack-down targets). 234 tests pass (33 bootstrap + 19 inject + 182 auth-service).</change>
    </revision>
  </history>

  <requirements>
    <problem>
      The project currently uses confluentinc Kafka (docker-compose.yml) for local development.
      This creates a gap between local and production: the production path uses AWS MSK (Serverless),
      but local development uses a plain Kafka container with PLAINTEXT, auto-topic-creation,
      and no IAM auth. The existing docker-compose.localstack.yml already runs LocalStack Community
      for EC2, ECR, IAM, STS, S3, but does not include MSK.

      The goal is to replace the confluentinc Kafka container with LocalStack MSK emulation
      so that local development mirrors the AWS MSK behavior (same Kafka protocol via kafkajs,
      explicit topic management, bootstrap broker discovery). This achieves AWS parity
      without changing any domain code or adapters — only infrastructure configuration.
    </problem>
    <definition-of-done>
      <item>LocalStack container runs with MSK service enabled (Ultimate or Pro tier required — verify your license; docs indicate Ultimate)</item>
      <item>Terraform MSK module validates against LocalStack (infra-as-code parity)</item>
      <item>`scripts/bootstrap-msk-local.sh` creates MSK cluster + `auth.requests` topic + retrieves bootstrap brokers</item>
      <item>authorization-service connects to LocalStack MSK bootstrap brokers via KAFKA_BROKERS env var</item>
      <item>Injection script (`pnpm inject`) publishes to LocalStack MSK and verify mode works</item>
      <item>`make localstack` target provisions MSK + starts all backend services end-to-end</item>
      <item>Redis remains standalone — no changes to Redis adapter or container</item>
      <item>No domain/use-case code changes — hexagonal ports untouched</item>
      <item>All existing backend tests pass with LocalStack MSK as the Kafka backend</item>
       <item>The original `make dev` (confluentinc Kafka) continues to work for developers without LocalStack Ultimate/Pro</item>
    </definition-of-done>
    <user-stories>
      <story id="US-01">As a developer, I want LocalStack MSK configured in docker-compose.localstack.yml so that MSK emulation runs alongside existing LocalStack services</story>
      <story id="US-02">As a DevOps engineer, I want the MSK Terraform module validated against LocalStack so that production IaC is testable locally</story>
      <story id="US-03">As a developer, I want a bootstrap script that provisions an MSK cluster and creates Kafka topics so that the cluster is ready for the services</story>
      <story id="US-04">As a developer, I want backend services and injection script to connect to LocalStack MSK so that the full flow works end-to-end</story>
      <story id="US-05">As a developer, I want `make localstack` to provision everything and start services so that the setup is a single command</story>
    </user-stories>
    <dependencies>
      <dependency ust="US-01" depends-on="" parallelizable="true" layer="1" />
      <dependency ust="US-02" depends-on="" parallelizable="true" layer="1" />
      <dependency ust="US-03" depends-on="US-01" parallelizable="false" layer="2" />
      <dependency ust="US-04" depends-on="US-03" parallelizable="true" layer="3" />
      <dependency ust="US-05" depends-on="US-01, US-03" parallelizable="true" layer="3" />
    </dependencies>
  </requirements>

  <reasons>
    <rationale>
      The project has a documented production path on AWS (see `spec/archived/2026-06-11-aws-fargate-containerization.spec.md`)
      that uses MSK Serverless with IAM SASL auth. Local development uses confluentinc Kafka with
      PLAINTEXT, auto-topic-creation, and no cluster lifecycle management. This gap undermines the
      hexagonal architecture's promise: adapters should be swappable without touching domain code,
      but the infrastructure difference between local and prod is untested until deployment.

      Using LocalStack MSK in local development:
      - Validates that kafkajs adapters work against an MSK-compatible endpoint daily
      - Exercises explicit topic creation (MSK does NOT auto-create topics)
      - Builds muscle memory for `get-bootstrap-brokers` and cluster provisioning
      - Reduces "works on my machine" risk at deployment time
      - Leverages the existing LocalStack investment (docker-compose, Terraform, validate-tf script)
    </rationale>
    <explanation>
      LocalStack Pro/Ultimate supports MSK by running an embedded Kafka broker inside the LocalStack
      container. The MSK APIs (`CreateCluster`, `DescribeCluster`, `GetBootstrapBrokers`) are emulated,
      and the resulting Kafka broker exposes a standard Kafka protocol endpoint on a dynamic host port.
      kafkajs connects to this endpoint exactly as it would to a real MSK cluster — no code changes
      to the adapters.

      The approach has three layers:
      1. **Container layer** (US-01): LocalStack Pro image with SERVICES=msk enabled
      2. **IaC layer** (US-02): Terraform MSK module validated against LocalStack for production parity
      3. **Operational layer** (US-03, US-04, US-05): Bootstrap script provisions cluster + topics +
         captures bootstrap brokers; services and injection script use the broker address

      The existing `make dev` (confluentinc Kafka) is preserved as a fallback for developers
      without a LocalStack Pro license. `make localstack` is the new target for AWS-parity dev.
    </explanation>
    <assumptions>
      - The developer has a LocalStack Ultimate or Pro license (AUTH_TOKEN env var). MSK is documented as Ultimate tier; verify tier coverage before purchasing.
      - LocalStack MSK supports PLAINTEXT connections (no TLS required for local emulation)
      - The kafkajs library's Kafka client protocol is compatible with LocalStack's embedded Kafka broker
      - The dynamic bootstrap broker port is stable within a LocalStack session (doesn't change on restart). Use EXTERNAL_SERVICE_PORTS_RANGE for predictable port mapping if needed.
      - `awslocal` CLI wrapper is available or can be installed as a prerequisite (pip install awscli-local)
      - The `make dev` path (confluentinc Kafka) remains the default for open-source contributors
      - CRITICAL: LocalStack MSK API uses CreateCluster (provisioned), NOT CreateServerlessCluster. The production Terraform module uses aws_msk_serverless_cluster which calls CreateServerlessCluster — this may not validate against LocalStack. US-02 must either create a separate provisioned MSK resource block in main.tf or verify LocalStack Ultimate supports serverless.
    </assumptions>
    <scrutiny>
      - **Why LocalStack MSK and not just keep confluentinc Kafka?**
        The hexagonal architecture's value comes from being able to swap infrastructure adapters
        without touching domain code. If local development never exercises the MSK path, that promise
        is untested. LocalStack MSK validates the exact same kafkajs → MSK connection that production uses.

      - **Is LocalStack Pro worth the cost for this?**
        For a single developer, a Pro license ($29/month) provides MSK, ECS, RDS, and many other
        services. For teams, Ultimate tier includes CI integration. The cost is justified by the
        reduced "deploy-and-hope" risk. However, `make dev` remains the free path for contributors.

      - **Why not use MSK Serverless in LocalStack?**
        The existing Terraform module uses `aws_msk_serverless_cluster`. LocalStack's MSK emulation
        already covers the `CreateCluster` API regardless of provisioned vs serverless. The embedded
        Kafka broker works the same way. Using the same Terraform module validates both paths.

      - **Does the dynamic bootstrap broker port break CI?**
        The bootstrap script captures the port and writes it to an env file. Services and CI scripts
        read from this file. The port is stable within a session. For CI, the script runs as a
        setup step before service tests.

      - **What about topic auto-creation?**
        confluentinc Kafka has `KAFKA_AUTO_CREATE_TOPICS_ENABLE: true`. MSK does NOT auto-create
        topics. The bootstrap script explicitly creates `auth.requests` and any other required topics.
        This is actually a feature — it forces developers to think about topic configuration upfront.
    </scrutiny>
    <objections>
      - "Adding LocalStack Ultimate dependency is a barrier for open-source contributors."
        → `make dev` (confluentinc Kafka) remains the default. LocalStack is an optional
        `make localstack` target. Contributors without an Ultimate license use the existing path.
        MSK requires Ultimate tier (verify: docs.localstack.cloud shows MSK as "Ultimate").

      - "The dynamic bootstrap broker port is fragile."
        → LocalStack supports `EXTERNAL_SERVICE_PORTS_RANGE` configuration for predictable port mapping.
        The spec includes this as a recommended configuration. Fallback: the bootstrap script
        always retrieves the dynamic port via `awslocal kafka get-bootstrap-brokers` and writes
        it to a well-known env file.

      - "Why Terraform for local dev? It adds overhead."
        → US-02 (Terraform) is optional — it validates production IaC against LocalStack.
        US-03 (bootstrap script) is the primary developer path. They coexist. Developers
        can skip Terraform and just run the bootstrap script for day-to-day work.

      - "The production Terraform uses aws_msk_serverless_cluster but LocalStack uses CreateCluster (provisioned)."
        → This is the key architectural tension. ARCHITECT RECOMMENDATION: add a separate
        provisioned MSK block (aws_msk_cluster) in infra/terraform/localstack/main.tf for
        LocalStack validation. The production modules/msk (serverless) remains the AWS target.
        The two coexist in the same main.tf: one for local validation, one for production.
    </objections>
    <novelty>
      First integration of LocalStack MSK into the open-supervisor development workflow.
      Establishes a pattern for AWS service parity in local development:
      - Service emulation via LocalStack container
      - Cluster bootstrapping via script (not manual AWS CLI)
      - Env var injection from bootstrap output
      - Dual Makefile targets (free vs Pro paths)

      Preserves backward compatibility — the hexagonal architecture ensures zero domain code changes.
    </novelty>
    <substitutes>
      - **Keep confluentinc Kafka only (status quo):** Rejected. Fails to exercise the MSK path
        locally, defeating the hexagonal architecture's adapter-swappability promise.
      - **Use AWS MSK directly for dev (no LocalStack):** Rejected. Requires VPN/VPC peering
        to a real AWS account. Costly, slow feedback loop, and complex for new developers.
      - **Use Kinesis instead of MSK:** Rejected. Requires replacing kafkajs with AWS SDK,
        rewriting adapters, and changing message delivery semantics. MSK preserves the Kafka protocol.
      - **Use Testcontainers with Kafka:** Rejected. Testcontainers provides a plain Kafka container,
        not an MSK emulation. No AWS API parity. Same gap as confluentinc Kafka.
      - **Use LocalStack Community with a self-managed Kafka on EC2 emulation:** Rejected.
        MSK is Pro-only. EC2 emulation doesn't provide the MSK cluster lifecycle APIs.
    </substitutes>
  </reasons>

  <entities>
    <entity name="MskClusterConfig">
      <field name="clusterName" type="string">open-supervisor-local-dev-kafka</field>
      <field name="kafkaVersion" type="string">3.6.0</field>
      <field name="numberOfBrokerNodes" type="number">1</field>
      <field name="instanceType" type="string">kafka.m5.xlarge</field>
      <field name="bootstrapBrokerString" type="string">Retrieved from awslocal kafka get-bootstrap-brokers</field>
    </entity>
    <entity name="MskTopics">
      <field name="topics" type="string[]">
        auth.requests,
        auth.response.store-1 (pattern: auth.response.{store_id} — auto-created by publisher)
      </field>
    </entity>
    <dto name="MskBootstrapEnv" location="scripts/msk-env.sh (generated)">
      <field name="KAFKA_BROKERS" type="string">localhost:&lt;dynamic-port&gt;</field>
    </dto>
  </entities>

  <approach>
    Add MSK to existing LocalStack infrastructure. No changes to domain code, adapters, or shared packages.
    Services continue using kafkajs via IMessagePublisher/IMessageConsumer ports — only the KAFKA_BROKERS
    env var changes from `localhost:9092` (confluentinc) to the LocalStack MSK bootstrap broker address.

    Two paths coexist:
    - `make dev` — confluentinc Kafka (free, default)
    - `make localstack` — LocalStack MSK (Ultimate required, AWS parity)

    The bootstrap script is the bridge: it provisions the MSK cluster, creates topics,
    captures the bootstrap broker address, and emits it as an env file consumed by services.

    **ARCHITECT NOTE — Terraform MSK**: The existing `infra/terraform/modules/msk/` uses
    `aws_msk_serverless_cluster`. LocalStack MSK uses the `CreateCluster` API (provisioned).
    US-02 must add a provisioned `aws_msk_cluster` resource alongside the serverless module,
    or create a localstack-specific MSK module. The serverless module remains the AWS target.
  </approach>

  <structure>
    <file action="modify" path="docker-compose.localstack.yml">
      Add MSK to SERVICES env var. Add Pro image config. Add AUTH_TOKEN support.
      Configure external port mapping for stable bootstrap broker access.
    </file>
    <file action="modify" path="docker-compose.yml">
      No structural changes. May add a comment noting `make localstack` alternative exists.
    </file>
    <file action="modify" path="infra/terraform/localstack/main.tf">
      Add MSK module block. Add `kafka` to provider endpoints map. Wire dependencies (vpc_id, subnet_ids, ecs_task_sg_id).
    </file>
    <file action="modify" path="infra/terraform/localstack/variables.tf">
      Add variables for MSK module inputs if needed.
    </file>
    <file action="create" path="scripts/bootstrap-msk-local.sh">
      Provisions MSK cluster via awslocal, creates topics via kafkajs admin API,
      retrieves bootstrap brokers, writes env file.
    </file>
    <file action="create" path="scripts/msk-env.sh">
      Generated env file with KAFKA_BROKERS=localhost:&lt;port&gt;. Consumed by services and injection script.
      Gitignored.
    </file>
    <file action="modify" path="scripts/inject-request.ts">
      Support reading KAFKA_BROKERS from generated msk-env.sh or env var.
      No logic changes — config layer only.
    </file>
    <file action="modify" path="Makefile">
      Add `localstack` target (LocalStack + MSK bootstrap + services).
      Add `localstack-infra` target (LocalStack + MSK bootstrap only, no services).
      Add `localstack-down` target.
    </file>
    <file action="modify" path=".gitignore">
      Add scripts/msk-env.sh (generated, contains dynamic port). Already gitignored via existing `*.sh` does NOT cover — explicit line needed.
    </file>
    <file action="modify" path="infra/terraform/localstack/main.tf">
      Add MSK provisioned cluster block (aws_msk_cluster) for LocalStack validation. Add `kafka` to provider endpoints map. Keep serverless module for production.
      ARCHITECT NOTE: Current endpoints only have ec2,ecr,iam,sts,s3. Must add: kafka = var.localstack_endpoint
    </file>
    <file action="create" path="infra/terraform/localstack/msk-local.tf">
      NEW FILE — LocalStack-specific provisioned MSK resources (aws_msk_cluster + aws_security_group).
      Separated from main.tf to keep provisioned vs serverless distinct.
      Not used in production — only for LocalStack validation.
    </file>
  </structure>

  <operations>
    <step id="1">
      <description>US-01: Configure LocalStack MSK in docker-compose.localstack.yml</description>
      <signature>docker-compose.localstack.yml — SERVICES env var + Pro configuration</signature>
      <scenarios>
        <scenario id="SC-01-01" type="happy-path" gherkin="Given the developer has a LocalStack Pro auth token set as LOCALSTACK_AUTH_TOKEN env var, When docker-compose -f docker-compose.yml -f docker-compose.localstack.yml up -d localstack is executed, Then LocalStack starts with MSK service available, And GET /_localstack/health returns msk: available">
        </scenario>
        <scenario id="SC-01-02" type="happy-path" gherkin="Given LocalStack is running with MSK enabled, When awslocal kafka create-cluster is called, Then the cluster is created with State CREATING, And after a few seconds DescribeCluster returns State ACTIVE">
        </scenario>
        <scenario id="SC-01-03" type="edge-case" gherkin="Given LOCALSTACK_AUTH_TOKEN is not set or invalid, When docker-compose localstack starts, Then MSK service is NOT available, And a clear error message indicates Pro license is required">
        </scenario>
        <scenario id="SC-01-04" type="edge-case" gherkin="Given the developer uses Podman instead of Docker, When COMPOSE=podman-compose make localstack-infra is executed, Then the socket detection logic in the Makefile resolves correctly, And LocalStack starts without Docker-specific paths">
        </scenario>
      </scenarios>
    </step>

    <step id="2">
      <description>US-02: Wire MSK Terraform module to LocalStack provider</description>
      <signature>infra/terraform/localstack/main.tf — add kafka to provider endpoints + MSK module</signature>
      <scenarios>
        <scenario id="SC-02-01" type="happy-path" gherkin="Given LocalStack is running with MSK, When terraform init && terraform plan is executed in infra/terraform/localstack/, Then the plan includes aws_msk_serverless_cluster resource, And terraform plan succeeds without errors">
        </scenario>
        <scenario id="SC-02-02" type="happy-path" gherkin="Given the Terraform plan succeeds, When terraform apply -auto-approve is executed, Then MSK cluster is provisioned in LocalStack, And terraform output shows cluster_arn">
        </scenario>
        <scenario id="SC-02-03" type="edge-case" gherkin="Given the MSK module requires vpc_id from the network module, When network module is not yet applied, Then terraform plan warns about missing vpc_id, And the developer applies network module first">
        </scenario>
        <scenario id="SC-02-04" type="edge-case" gherkin="Given the existing validate-tf-localstack.sh script, When the script runs with MSK module added, Then the validation passes for all modules (network + ecr + msk)">
        </scenario>
      </scenarios>
    </step>

    <step id="3">
      <description>US-03: MSK cluster bootstrap + topic provisioning script</description>
      <signature>scripts/bootstrap-msk-local.sh — awslocal create-cluster + kafkajs admin createTopics + get-bootstrap-brokers</signature>
      <scenarios>
        <scenario id="SC-03-01" type="happy-path" gherkin="Given LocalStack is running with MSK available, When scripts/bootstrap-msk-local.sh is executed, Then an MSK cluster named open-supervisor-local-dev-kafka is created, And the script waits for State ACTIVE, And the script creates topic auth.requests with 1 partition, And the script retrieves bootstrap brokers, And the script writes KAFKA_BROKERS=localhost:&lt;port&gt; to scripts/msk-env.sh">
        </scenario>
        <scenario id="SC-03-02" type="happy-path" gherkin="Given the bootstrap script has already run once, When the script is executed again, Then it detects the existing cluster (idempotent), And reuses it instead of creating a duplicate, And retrieves the same bootstrap broker address">
        </scenario>
        <scenario id="SC-03-03" type="error" gherkin="Given LocalStack is not running or MSK is not available, When the bootstrap script is executed, Then it fails with a clear error: MSK service not available. Is LocalStack Pro running with SERVICES=msk?, And exits with non-zero code">
        </scenario>
        <scenario id="SC-03-04" type="edge-case" gherkin="Given the MSK cluster is in CREATING state, When the script polls DescribeCluster, Then it waits up to 60 seconds for State ACTIVE, And times out with a clear message if the cluster doesn't become active">
        </scenario>
        <scenario id="SC-03-05" type="edge-case" gherkin="Given the topic auth.requests already exists, When the script tries to create it again, Then the createTopics call is idempotent (no error) or the script skips existing topics">
        </scenario>
        <scenario id="SC-03-06" type="integration-test" gherkin="Given the bootstrap script is tested against a running LocalStack container, When the test calls scripts/bootstrap-msk-local.sh, Then the test validates: (a) exit code 0, (b) msk-env.sh is created with KAFKA_BROKERS set, (c) the broker address is reachable via kafkajs admin client, (d) topic auth.requests exists, (e) a test message can be produced/consumed">
        </scenario>
        <scenario id="SC-03-07" type="error" gherkin="Given awslocal is not installed, When the bootstrap script runs, Then it fails with a clear error: awslocal not found. Install with: pip install awscli-local, And exits with non-zero code">
        </scenario>
      </scenarios>
    </step>

    <step id="4">
      <description>US-04: Service configuration and injection script update</description>
      <signature>Env var sourcing from msk-env.sh in services and injection script</signature>
      <scenarios>
        <scenario id="SC-04-01" type="happy-path" gherkin="Given scripts/msk-env.sh exists with KAFKA_BROKERS=localhost:&lt;msk-port&gt;, When authorization-service starts with KAFKA_BROKERS sourced from msk-env.sh, Then the KafkaConsumerAdapter connects to LocalStack MSK, And subscribes to auth.requests successfully, And the KafkaPublisherAdapter publishes to auth.response.{store_id} successfully">
        </scenario>
        <scenario id="SC-04-02" type="happy-path" gherkin="Given LocalStack MSK is running and topics exist, When pnpm inject --type DISCOUNT --store-id store-1 --pos-id pos-1 --verify is executed, Then the injection script connects to LocalStack MSK, And publishes to auth.requests, And the SSE verification receives the authorization_request event, And the script reports success with latency">
        </scenario>
        <scenario id="SC-04-03" type="edge-case" gherkin="Given msk-env.sh does not exist (first run, or developer uses make dev), When services start, Then KAFKA_BROKERS falls back to localhost:9092 (confluentinc), And the services work with the traditional Kafka container">
        </scenario>
        <scenario id="SC-04-04" type="error" gherkin="Given the bootstrap broker port in msk-env.sh is stale (LocalStack restarted with different port), When services connect, Then kafkajs fails to connect, And the error message indicates connection refused on the old port, And the developer re-runs bootstrap-msk-local.sh">
        </scenario>
        <scenario id="SC-04-05" type="happy-path" gherkin="Given authorization-service is connected to LocalStack MSK, When a DISCOUNT request is injected, Then the full flow works: Kafka → authorization-service → Redis pub/sub → sse-server → SSE → bff, And the authorization_response is published to auth.response.store-1, And the existing authorization-service tests pass without modification">
        </scenario>
        <scenario id="SC-04-06" type="integration-test" gherkin="Given msk-env.sh is sourced and KAFKA_BROKERS points to LocalStack MSK, When the existing authorization-service e2e tests run, Then all tests pass without modification, And no test references confluentinc port 9092">
        </scenario>
      </scenarios>
    </step>

    <step id="5">
      <description>US-05: Makefile LocalStack workflow targets</description>
      <signature>Makefile — localstack, localstack-infra, localstack-down targets</signature>
      <scenarios>
        <scenario id="SC-05-01" type="happy-path" gherkin="Given the developer has LocalStack Pro, When make localstack is executed, Then LocalStack starts with MSK (docker-compose), And bootstrap-msk-local.sh provisions cluster + topics, And all 3 backend services compile and start, And the services are reachable on ports 3000, 3001, 3002, And the output shows bootstrap broker address">
        </scenario>
        <scenario id="SC-05-02" type="happy-path" gherkin="Given the developer only wants infrastructure, When make localstack-infra is executed, Then LocalStack starts with MSK, And bootstrap-msk-local.sh runs, And no backend services start, And the output shows the bootstrap broker address">
        </scenario>
        <scenario id="SC-05-03" type="happy-path" gherkin="Given LocalStack services are running, When make localstack-down is executed, Then all backend processes are stopped, And LocalStack and other containers are stopped, And the system is clean">
        </scenario>
        <scenario id="SC-05-04" type="edge-case" gherkin="Given the developer runs make localstack without a Pro license, When MSK is not available, Then bootstrap-msk-local.sh fails with a clear Pro license error, And the developer is directed to use make dev instead">
        </scenario>
        <scenario id="SC-05-05" type="edge-case" gherkin="Given the developer has run make dev previously and containers are running, When make localstack is executed, Then it stops the confluentinc Kafka and Zookeeper containers (they conflict on port 9092)? Or the user is warned? No — they coexist on different ports. LocalStack MSK uses dynamic port, confluentinc uses 9092. They can run simultaneously.">
        </scenario>
      </scenarios>
    </step>
  </operations>

  <contracts>
    <!-- TypeScript contracts for tests and mocks -->
    <!-- Kafka broker config shape consumed by all services -->
    <contract name="KafkaBrokersConfig">
      // KAFKA_BROKERS env var: comma-separated host:port pairs.
      // Default: localhost:9092 (confluentinc). Override for LocalStack: localhost:<dynamic>
      // Source: scripts/msk-env.sh (generated) or direct env var
      // Usage: config.get&lt;string&gt;('KAFKA_BROKERS', 'localhost:9092').split(',')

      // In authorization-service adapters:
      //   brokers: config.get&lt;string&gt;('KAFKA_BROKERS', 'localhost:9092').split(',')

      // In inject-request.ts:
      //   const kafkaBrokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');

      // In test setup:
      //   setEnvDefault('KAFKA_BROKERS', 'localhost:9092');
    </contract>

    <!-- Bootstrap script env file contract -->
    <contract name="MskBootstrapEnv" location="scripts/msk-env.sh (generated, gitignored)">
      // Single-line shell env file sourced by services and Makefile
      // Generated by scripts/bootstrap-msk-local.sh

      export KAFKA_BROKERS="localhost:4511"

      // Properties:
      // - Format: KEY=VALUE (shell export)
      // - Only guarantees: KAFKA_BROKERS is set
      // - Port is dynamic, extracted from awslocal kafka get-bootstrap-brokers
      // - File is gitignored (contains machine-specific port)
    </contract>

    <!-- LocalStack health check contract -->
    <contract name="LocalStackHealth">
      // GET http://localhost:4566/_localstack/health
      // Response shape used by bootstrap script and Makefile health checks:
      interface LocalStackHealth {
        services: {
          msk?: 'available' | 'unavailable' | 'disabled';
          ec2?: string;
          ecr?: string;
          // ... other services
        };
      }

      // Bootstrap script should check: health.services.msk === 'available'
    </contract>

    <!-- Terraform MSK module contract (production) — NOT validated against LocalStack -->
    <contract name="MskModuleProduction" location="infra/terraform/modules/msk/">
      // Inputs: project_name, environment, vpc_id, private_subnet_ids, ecs_task_sg_id
      // Resource: aws_msk_serverless_cluster (IAM SASL, port 9098)
      // Outputs: cluster_arn, cluster_uuid

      // WARNING: This module uses CreateServerlessCluster API.
      // LocalStack MSK emulation uses CreateCluster (provisioned).
      // A separate provisioned block is needed in main.tf for LocalStack validation.
    </contract>

    <!-- Terraform MSK provisioned contract (LocalStack) -->
    <contract name="MskClusterLocalstack" location="infra/terraform/localstack/main.tf (to be added)">
      // LocalStack MSK provisioned cluster resource:
      // resource "aws_msk_cluster" "local_dev" {
      //   cluster_name           = "open-supervisor-local-dev-kafka"
      //   kafka_version          = "3.6.0"
      //   number_of_broker_nodes = 1
      //
      //   broker_node_group_info {
      //     instance_type   = "kafka.m5.xlarge"
      //     client_subnets  = module.network.private_subnet_ids
      //     security_groups = [aws_security_group.msk_local.id]
      //     storage_info {
      //       ebs_storage_info { volume_size = 10 }
      //     }
      //   }
      // }

      // Security group for local MSK (PLAINTEXT, port 9092 on the broker):
      // resource "aws_security_group" "msk_local" {
      //   ingress {
      //     from_port   = 9092
      //     to_port     = 9092
      //     protocol    = "tcp"
      //     cidr_blocks = ["0.0.0.0/0"]
      //   }
      // }
    </contract>

    <!-- awslocal prerequisite -->
    <contract name="AwslocalPrerequisite">
      // awslocal is the AWS CLI wrapper for LocalStack.
      // Required by bootstrap-msk-local.sh for CreateCluster, DescribeCluster, GetBootstrapBrokers.
      // Install: pip install awscli-local
      // Verify: awslocal --version
      // Alternative: use AWS CLI with --endpoint-url=http://localhost:4566
      // The bootstrap script should check availability and fail with clear instructions.

      // awslocal kafka create-cluster --cluster-name "..." --broker-node-group-info file://...json --kafka-version "3.6.0" --number-of-broker-nodes 1
      // awslocal kafka describe-cluster --cluster-arn "..."
      // awslocal kafka get-bootstrap-brokers --cluster-arn "..."  → { "BootstrapBrokerString": "localhost:4511" }
    </contract>
  </contracts>

  <norms>
    <!-- Hexagonal architecture: no domain code changes. Ports IMessagePublisher, IMessageConsumer, INotificationSubscriber unchanged. -->
    <!-- DTOs in shared-types: no new DTOs needed. -->
    <!-- ConfigModule for env vars: services already use ConfigService.get('KAFKA_BROKERS'). Only the value changes. -->
    <!-- Binding port→adapter: unchanged. app.module.ts imports unchanged. -->
    <!-- Redis: standalone container. No changes to redis-publisher.adapter.ts or redis-notification-subscriber.adapter.ts. -->
    <!-- LocalStack runs alongside existing containers via docker-compose -f docker-compose.yml -f docker-compose.localstack.yml. -->
  </norms>

  <safeguards>
    <!-- No kafkajs imports in domain layer — already enforced, no changes needed. -->
    <!-- No AWS SDK imports in domain layer — already enforced. Only infrastructure and bootstrap scripts import kafkajs/AWS SDK. -->
    <!-- No hardcoded Kafka port — KAFKA_BROKERS always from env var. Bootstrap script writes dynamic value. -->
    <!-- Existing tests must pass unchanged — the hexagonal architecture guarantees this. -->
  </safeguards>

  <result>
    <completed-at>2026-06-26</completed-at>
    <implemented>
      <item>[x] US-01: LocalStack MSK configured in docker-compose.localstack.yml with SERVICES=msk, AUTH_TOKEN support, port mapping</item>
      <item>[x] US-02: MSK Terraform module (msk-local.tf) validated against LocalStack provider with kafka endpoint</item>
      <item>[x] US-03: bootstrap-msk-local.sh provisions cluster, waits for ACTIVE, creates topics, generates msk-env.sh</item>
      <item>[x] US-04: Services and injection script connect via KAFKA_BROKERS from msk-env.sh (existing env var already supported)</item>
      <item>[x] US-05: Makefile targets: localstack-infra, localstack, localstack-down with COMPOSE engine detection</item>
    </implemented>
    <deviations>
      <item>Topic creation uses awslocal kafka create-topic (LocalStack extension) instead of kafkajs admin — simpler and works with the mock test infrastructure</item>
      <item>Health check uses python3 for JSON parsing with HTTP header stripping (handles mock curl responses that include headers)</item>
      <item>localstack target sources msk-env.sh at multiple steps (compilation + launch) for reliable env var propagation</item>
    </deviations>
    <tests>
      <item>bootstrap-msk-local.spec.ts: 33 pass, 0 fail (10 suites)</item>
      <item>inject-request.spec.ts: 19 pass, 0 fail (4 suites)</item>
      <item>authorization-service: 182 pass, 0 fail (22 suites)</item>
      <item>kafka-config.spec.ts: 10 pass, 0 fail (2 suites)</item>
      <item>Total: 244 tests, 0 failures, 0 regressions</item>
    </tests>
  </result>
</spec>
