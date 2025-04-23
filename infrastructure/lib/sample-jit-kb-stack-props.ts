import * as cdk from 'aws-cdk-lib';

export interface SampleJITKBStackProps extends cdk.StackProps {
    enableLocalhost: boolean;
    prefix: string;
}  