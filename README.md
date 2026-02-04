<p align="center">
    <picture>
        <source srcset="images/soko-logo-dark.svg" media="(prefers-color-scheme: dark)">
        <source srcset="images/soko-logo-light.svg" media="(prefers-color-scheme: light)">
        <img alt="Soko Logo" src="images/soko-logo-light.svg" />
    </picture>
<div>
<p align="center">
    <strong>Warehouse for smart-contract compilation artifacts.</strong>
</p>

> [!WARNING]
> Work in progress.

## What is Soko?

Soko enables teams to **version**, **store** and **share** smart-contract compilation artifacts.  
As such, it decouples the compilation process from the deployment process.

Soko supports both Hardhat and Foundry development environments, compile once, deploy safely.

<picture>
    <source srcset="images/soko-workflow-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="images/soko-workflow-light.svg" media="(prefers-color-scheme: light)">
    <img alt="Soko workflow" src="images/soko-workflow-light.svg" />
</picture>

## Hardhat Soko

Soko is for now available as a Hardhat plugin.

It supports Hardhat V3, Hardhat V2 and Foundry as development environments.

Soko stores compilation artifacts in your storage backend of choice, for now only AWS S3 is supported.

See the [Hardhat Soko documentation](packages/hardhat-soko/README.md)
for a complete guide of the plugin, its commands, configuration options and features.

### Configure

Import and configure the plugin in the `hardhat.config.ts` file:

```ts
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
...
import "@soko/hardhat-soko";

export const config: HardhatUserConfig = {
  ... // Existing configuration
  // Example configuration for Soko with AWS S3 as storage for compilation artifacts
  soko: {
    project: "doubtful-project",
    storageConfiguration: {
      type: "aws",
      awsRegion: MY_AWS_REGION,
      awsBucketName: MY_AWS_S3_BUCKET,
      awsAccessKeyId: MY_AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: MY_AWS_SECRET_ACCESS_KEY,
    },
  },
}
```

### Development process

Once compilation is done, push the artifacts to Soko under a specific tag

```bash
npx hardhat soko push --artifact-path ./artifacts --tag 2026-02-02
```

### Deployment process

Pull the project artifacts from Soko locally

```bash
npx hardhat soko pull
```

Generate TypeScript typings for the pulled artifacts

```bash
npx hardhat soko typings
```

Write scripts in a fully typed and transparent manner

```ts
...
import { project } from "../.soko-typings";

async function deployFoo() {
    // Get project utilities for the target tag
    const projectUtils = project("doubtful-project").tag("2026-02-02");

    // Get `Foo` static artifact for the target release
    const myContractArtifact = await projectUtils.getContractArtifact(
      "src/Foo.sol:Foo",
    );

    // Deploy `Foo` using the static artifact
    // "À la Hardhat Deploy"
    await deploy("Foo@2026-02-02", {
      contract: {
        abi: myContractArtifact.abi,
        bytecode: myContractArtifact.evm.bytecode.object,
        metadata: myContractArtifact.metadata,
      },
    })
}
```

### Complete guide and examples

Please refer to the [Hardhat Soko documentation](packages/hardhat-soko/README.md)
for a complete guide of the plugin, its commands, configuration options and features.

Examples of projects using Hardhat Soko can be found in the `apps/` folder:

- [hardhat-v2_hardhat-deploy-v0](apps/hardhat-v2_hardhat-deploy-v0/README.md): compile a contract with Hardhat V2, deploy using Hardhat Deploy V0.12,
- [hardhat-v2_hardhat-deploy-v0_external-lib](apps/hardhat-v2_hardhat-deploy-v0_external-lib/README.md): compile a contract and its external library with Hardhat V2, deploy using Hardhat Deploy V0.12.

## FAQ

### When to use Soko?

Use Soko when you want to

- **decouple compilation from deployment**: development and compilation is in a different phase than deployment and maintenance,
- **safely and transparently deploy** smart-contracts using static compilation artifacts, no bad surprises,
- **collaborate easily** across your team by sharing ABIs and compilation artifacts, no compile into copy-pasting wrong ABIs.

### When NOT to use Soko?

Don't use Soko when

- you are prototyping and iterating fast, Soko adds some friction that is not needed at this stage,
- you don't care about transparency and reproducibility of your deployments or scripts.

## Contributing

Thank you for your interest in contributing to Soko! Please see our [contributing guidelines](CONTRIBUTING.md) for more information.
