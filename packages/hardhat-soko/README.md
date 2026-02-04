# Hardhat Soko

Hardhat plugin in order to interact with Soko, warehouse for smart contract compilation artifacts.

## Installation

Installation can be made using any package manager

```bash
pnpm install @soko/hardhat-soko
npm install @soko/hardhat-soko
yarn add @soko/hardhat-soko
```

## Configuration

In the `hardhat.config.ts/js` file, one should import the `@soko/hardhat-soko` plugin and fill the Soko configuration.

```ts
import { HardhatUserConfig } from "hardhat/config";
...
import "@soko/hardhat-soko";

export const config: HardhatUserConfig = {
  ... // Existing configuration
  // Example configuration for Soko with AWS S3 as storage for compilation artifacts
  soko: {
    project: "doubtful-project", // Name of the project, used when pushing artifacts and as default for other commands
    pulledArtifactsPath: ".soko", // Local path for pulled artifacts, default to `.soko`
    typingsPath: ".soko-typings", // Local path for generated typings, default to `.soko-typings`
    storageConfiguration: { // Configuration of the storage, only AWS S3 is supported for now
      type: "aws",
      awsRegion: MY_AWS_REGION,
      awsBucketName: MY_AWS_S3_BUCKET,
      awsAccessKeyId: MY_AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: MY_AWS_SECRET_ACCESS_KEY,
      // Optional IAM role assumption
      awsRole: {
        roleArn: MY_AWS_ROLE_ARN,
        externalId: MY_AWS_EXTERNAL_ID, // Optional, required if role policy enforces it
        sessionName: "soko-hardhat-session", // Optional, default is "soko-hardhat-session"
        durationSeconds: 3600, // Optional, 900-43200 (must be allowed by role)
      },
    },
    debug: false, // If true, all tasks are running with debug mode enabled, default to `false`
  },
}
```

It is recommended to add the folders for pulled artifacts and typings to the `.gitignore` file. They can be regenerated at any time.

## Projects, tags and IDs

A unique **ID**, e.g. `b5e41181986a`, is derived for each compilation artifact. The ID is based on the content of the artifact.

A **tag**, e.g. `2026-02-02` or `v1.2.3`, can be associated to a compilation artifact when pushed.

A **project**, e.g. `doubtful-project`, will gather many compilation artifacts.

The project setup in the Hardhat Config will be used as

- target project when pushing new compilation artifacts,
- default project for pulling artifacts or other commands, different project can be specified for those commands.

## Tasks

> [!NOTE]
> The code snippets in this section uses `npx` but one can choose something else

An overview of the Soko tasks is exposed by running the `soko` task:

```bash
npx hardhat soko
```

Help about any task scopped under soko is available:

```bash
npx hardhat help soko push
```

### Push

Push a local compilation artifact for the configured project to the storage, creating the remote artifact with its ID and optionally tagging it.

Only push the compilation artifact without an additional tag:

```bash
npx hardhat soko push --artifact-path ./artifacts
```

Or use a tag to associate the compilation artifact with it

```bash
npx hardhat soko push --artifact-path ./artifacts --tag 2026-02-02
```

> [!NOTE]
> Hardhat Soko will try to read the compilation artifact from the provided path. If multiple choices are possible, it will ask the user to select one of them. One can avoid this prompt by providing the full path to the compilation artifact or ensure there is only one compilation artifact in the provided path.

### Pull

Pull locally the missing artifacts from the configured storage.

One can pull all the artifacts from the configured project

```bash
npx hardhat soko pull
```

Or target a specific artifact using its tag or ID or another project:

```bash
npx hardhat soko pull --id b5e41181986a
npx hardhat soko pull --tag 2026-02-02
npx hardhat soko pull --tag v1.2.3 --project another-project
```

### Typings

Once the artifacts have been pulled, one can generate the TypeScript typings based on the pulled projects.

```bash
npx hardhat soko typings
```

> [!NOTE]
> If no projects have been pulled, one can still generate the default typings using this command. It may be helpful for those who do not care about the scripts involving Soko but want to be unblocked in case of missing files.

### List

List the pulled projects and their compilation artifacts.

```bash
npx hardhat soko list
```

### Diff

Compare a local compilation artifacts with an existing compilation artifact and print the contracts for which differences have been found.

```bash
npx hardhat soko diff --artifact-path ./artifacts --tag 2026-02-02
npx hardhat soko diff --artifact-path ./artifacts --id b5e41181986a
```

## Using the typings

The typings are exposed in order to help the developer retrieve easily and safely a contract artifact (ABI, bytecode, etc...).

There are two available utils in order to retrieve a contract artifact, it would depend on the task at hand:

- start with a contract, select one of its available tags

```ts
import { project } from "../.soko-typings";

const artifact = await project("doubtful-project")
  .contract("src/path/to/my/contract.sol:Foo")
  .getArtifact("2026-02-02");
```

- start with a tag, select a contract within it

```ts
import { project } from "../.soko-typings";

const artifact = await project("doubtful-project")
  .tag("2026-02-02")
  .getContractArtifact("src/path/to/my/contract.sol:Foo");
```

If typings have been generated from existing projects, the inputs of the utils will be strongly typed and wrong project, tags or contracts names will be detected.

In case there are no projects or the projects have not been pulled, the generated typings are made in such a way that strong typecheck disappears and any string can be used with the helper functions.

### Retrieve full compilation artifact

The full compilation artifact of a tag can be retrieved using the `project("doubtful-project").tag("2026-02-02").getCompilationArtifact` method.

### Example with hardhat-deploy v0

An example can be made with the [hardhat-deploy](https://github.com/wighawag/hardhat-deploy) plugin for deploying a released smart contract.

The advantage of this deployment is that it only works with frozen artifacts. New development will never have an impact on it.

```ts
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { project } from "../.soko-typings";

const deployMyExample: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
) {
  const { deployer } = await hre.getNamedAccounts();

  const fooArtifact = await project("doubtful-project")
    .contract("src/Example.sol:Foo")
    .getArtifact("2026-02-02");

  await hre.deployments.deploy(`Foo@2026-02-02`, {
    contract: {
      abi: fooArtifact.abi,
      bytecode: fooArtifact.evm.bytecode.object,
      metadata: fooArtifact.metadata,
    },
    from: deployer,
  });
};

export default deployMyExample;
```

## Storage configurations

Currently only AWS S3 storage configuration is supported.

### AWS S3

Compilation artifacts are stored in an [AWS S3 bucket](https://aws.amazon.com/s3/).

Before using Soko with AWS S3, one need to create an S3 bucket and have AWS credentials with access to it. The configuration requires:

- `awsRegion`: AWS region where the S3 bucket is located
- `awsBucketName`: Name of the S3 bucket
- `awsAccessKeyId`: AWS access key ID of the credentials
- `awsSecretAccessKey`: AWS secret access key of the credentials.

Optionally, you can assume an IAM role using the provided credentials:

- `awsRole.roleArn`: ARN of the IAM role to assume
- `awsRole.externalId`: Optional external ID for cross-account role assumption
- `awsRole.sessionName`: Optional role session name (default: `soko-hardhat-session`)
- `awsRole.durationSeconds`: Optional session duration in seconds (900-43200)

Make sure the credentials used have the right permissions to read and write objects in the S3 bucket.

When `awsRole` is provided, Soko assumes the role using the access key and secret key, and uses the temporary credentials for S3 operations. The credentials are cached in memory for the duration of the task.

It is possible to use a single bucket for multiple projects, Soko will handle the organization of the artifacts within the bucket.

## Integration examples

The monorepo contains example projects using different toolchains:

- [hardhat-v2_hardhat-deploy-v0](apps/hardhat-v2_hardhat-deploy-v0/README.md): compile a contract with Hardhat V2, deploy using Hardhat Deploy V0.12,
- [hardhat-v2_hardhat-deploy-v0_external-lib](../apps/hardhat-v2_hardhat-deploy-v0_external-lib/README.md): compile a contract and its external library with Hardhat V2, deploy using Hardhat Deploy V0.

## Contributing

See `CONTRIBUTING.md` for test and development guidelines.
