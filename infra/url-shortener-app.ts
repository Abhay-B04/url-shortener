import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { Construct } from "constructs";
import * as path from "path";

export class UrlShortenerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── DynamoDB Table ────────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, "LinksTable", {
      tableName: "url-shortener-links",
      partitionKey: { name: "code", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── Lambda shared env ─────────────────────────────────────────────────────
    const commonEnv = {
      TABLE_NAME: table.tableName,
      NODE_OPTIONS: "--enable-source-maps",
    };

    const bundling: lambda.AssetCode = lambda.Code.fromAsset(
      path.join(__dirname, "../lambdas"),
      {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [
            "bash",
            "-c",
            [
              "npm install --prefix /asset-output nanoid@3 @aws-sdk/client-dynamodb",
              "cp -r /asset-input/* /asset-output/",
            ].join(" && "),
          ],
          user: "root",
        },
      }
    );

    // ─── Lambda: Create ────────────────────────────────────────────────────────
    const createFn = new lambda.Function(this, "CreateFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "create/index.handler",
      code: bundling,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });

    // ─── Lambda: Redirect ──────────────────────────────────────────────────────
    const redirectFn = new lambda.Function(this, "RedirectFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "redirect/index.handler",
      code: bundling,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
    });

    // ─── Lambda: List ──────────────────────────────────────────────────────────
    const listFn = new lambda.Function(this, "ListFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "list/index.handler",
      code: bundling,
      environment: commonEnv,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
    });

    // ─── DynamoDB permissions ──────────────────────────────────────────────────
    table.grantWriteData(createFn);
    table.grantReadWriteData(redirectFn);
    table.grantReadData(listFn);

    // ─── HTTP API Gateway ──────────────────────────────────────────────────────
    const api = new apigw.HttpApi(this, "HttpApi", {
      apiName: "url-shortener-api",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    const apiUrl = api.apiEndpoint;
    createFn.addEnvironment("BASE_URL", apiUrl);
    listFn.addEnvironment("BASE_URL", apiUrl);
    redirectFn.addEnvironment("BASE_URL", apiUrl);

    api.addRoutes({
      path: "/links",
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("CreateInt", createFn),
    });

    api.addRoutes({
      path: "/{code}",
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("RedirectInt", redirectFn),
    });

    api.addRoutes({
      path: "/admin/links",
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("ListInt", listFn),
    });

    // ─── S3 + CloudFront ───────────────────────────────────────────────────────
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });

    new s3deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../frontend"))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // ─── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: api.apiEndpoint,
      description: "HTTP API base URL",
    });

    new cdk.CfnOutput(this, "FrontendUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CloudFront frontend URL",
    });

    new cdk.CfnOutput(this, "DynamoTableName", {
      value: table.tableName,
      description: "DynamoDB table name",
    });
  }
}