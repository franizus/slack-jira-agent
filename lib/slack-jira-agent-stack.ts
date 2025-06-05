import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs";
import {Runtime} from "aws-cdk-lib/aws-lambda";
import path = require('path');
import {LambdaRestApi} from "aws-cdk-lib/aws-apigateway";
import * as dotenv from 'dotenv'; 

dotenv.config(); 

export class SlackJiraAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const slackAgentLambda = new NodejsFunction(this, 'slackAgentLambda', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, `../src/slack-agent.ts`),
      timeout: cdk.Duration.seconds(60), // Set a timeout for the Lambda function
      handler: 'handler', // Assumes the entry point is slack-events.js and the handler is named handler
      environment: {
        // Add any environment variables needed for your Lambda function
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY!,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
        MONGODB_URI: process.env.MONGODB_URI!,
      },
    });

    // Define the Lambda function
    const slackEventsLambda = new NodejsFunction(this, 'SlackEventsLambda', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, `../src/slack-events.ts`),
      timeout: cdk.Duration.seconds(29), // Set a timeout for the Lambda function
      handler: 'handler', // Assumes the entry point is slack-events.js and the handler is named handler
      environment: {
        // Add any environment variables needed for your Lambda function
        TARGET_LAMBDA_ARN: slackAgentLambda.functionArn, // Pass the ARN of the slackAgentLambda
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
        MONGODB_URI: process.env.MONGODB_URI!,
      },
    });

    // Grant slackEventsLambda permission to invoke slackAgentLambda
    slackAgentLambda.grantInvoke(slackEventsLambda);

    // Define the API Gateway
    const api = new LambdaRestApi(this, 'SlackEventsApi', {
      handler: slackEventsLambda,
      proxy: false, // Allows custom routes
    });

    // Add a POST method to the root resource
    const slackResource = api.root.addResource('slack');
    slackResource.addMethod('POST');
  }
}
