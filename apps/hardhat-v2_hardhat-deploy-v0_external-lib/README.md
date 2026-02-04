# Hardhat Soko - Example - Deploy Counter with external library

This is an example of integration between [Hardhat V2](https://v2.hardhat.org/) and [Soko](https://github.com/VGLoic/soko-monorepo), demonstrating how to deploy a smart contract that depends on an external library.

The [Hardhat-Deploy](https://rocketh.dev/hardhat-deploy/) (`hardhat-deploy@0.12.4` i.e. `v1`) plugin is used to manage deployments.

## Workflow

### Content

In this example, we implement a a simple `Counter` contract that relies on an external library `IncrementOracle` to increment its value, see [Counter.sol](./src/Counter.sol) and [IncrementOracle.sol](./src/IncrementOracle.sol).

### Development phase

Development is done as usual, with as many tests or else.

### Release phase

Once the development is considered done, one can create the compilation artifacts:

```bash
npx hardhat compile
```

The compilation artifacts will be pushed to `Soko`, hence freezing them for later use.

```bash
# The tag v1.0.1 is arbitrary, it can be any string identifying the release
npx hardhat soko push --artifact-path ./artifacts --tag v1.0.1
```

### Deployment phase

Later on, the same developper or another one wants to deploy the contracts for the `v1.0.1` release.
It will first pull the compilation artifacts from `Soko`:

```bash
npx hardhat soko pull
```

REMIND ME: Add image of list output once more beautiful

Then, generates the typings in order to write a type-safe deployment script:

```bash
npx hardhat soko typings
```

Finally, the deployer can write a deployment script, e.g. [00-deploy-counter-v1.0.1.ts](./deploy/00-deploy-counter-v1.0.1.ts), that will retrieve the compilation artifacts from `Soko` and deploy the contracts accordingly.

```ts
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { project } from "../.soko-typings";

const TARGET_RELEASE = "v1.0.1";

const deployCounter: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
) {
  const { deployer } = await hre.getNamedAccounts();

  // Get project utilities for the target release
  const projectUtils = project("doubtful-counter").tag(TARGET_RELEASE);

  // Get the `IncrementOracle` artifact for the target release and deploy it
  const incrementOracleArtifact = await projectUtils.getContractArtifact(
    "src/IncrementOracle.sol:IncrementOracle",
  );
  const incrementOracleDeployment = await hre.deployments.deploy(
    `IncrementOracle@${TARGET_RELEASE}`,
    {
      contract: {
        abi: incrementOracleArtifact.abi,
        bytecode: incrementOracleArtifact.evm.bytecode.object,
        metadata: incrementOracleArtifact.metadata,
      },
      from: deployer,
    },
  );

  // Get the `Counter` artifact for the target release and deploy it
  const counterArtifact = await projectUtils.getContractArtifact(
    "src/Counter.sol:Counter",
  );
  await hre.deployments.deploy(`Counter@${TARGET_RELEASE}`, {
    contract: {
      abi: counterArtifact.abi,
      bytecode: counterArtifact.evm.bytecode.object,
      metadata: counterArtifact.metadata,
    },
    libraries: {
      "src/IncrementOracle.sol:IncrementOracle":
        incrementOracleDeployment.address,
    },
    from: deployer,
  });
};
```

The deployment script can be executed using the Hardhat-Deploy plugin:

```bash
npx hardhat deploy --no-compile --network <network-name>
```

The `no-compile` flag is optional and here to highlight that no compilation is needed since we are working with static artifacts from `Soko`.

The deployment is by nature idempotent, this is guaranteed by the fact that the used artifacts are static and the Hardhat-Deploy plugin.
