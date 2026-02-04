import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "@soko/hardhat-soko";
import "dotenv/config";
import { SokoHardhatUserConfig } from "@soko/hardhat-soko";

const sokoConfig: SokoHardhatUserConfig = {
  project: "doubtful-counter",
  pulledArtifactsPath: ".soko",
  typingsPath: ".soko-typings",
  storageConfiguration: {
    type: "aws",
    awsRegion: process.env.AWS_REGION || "",
    awsBucketName: process.env.AWS_S3_BUCKET || "",
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    awsRole: process.env.AWS_ROLE_ARN
      ? {
          roleArn: process.env.AWS_ROLE_ARN,
        }
      : undefined,
  },
};

// Issue with hardhat config typing and module augmentation
// It works fine when importing the build package directly but does not work in the monorepo setup
// As a workaround, we cast the config to include the soko field
export const config: HardhatUserConfig & { soko?: SokoHardhatUserConfig } = {
  namedAccounts: {
    deployer: {
      default: 0, // First account is taken as deployer
    },
  },
  soko: sokoConfig,
  networks: {
    localhost: {
      chainId: 31337,
    },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: { mnemonic: process.env.SEPOLIA_MNEMONIC || "" },
      verify: {
        etherscan: {
          apiKey: process.env.ETHERSCAN_API_KEY || "",
        },
      },
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
  },
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./src", // Use ./src rather than ./contracts as Hardhat expects
  },
};

export default config;
