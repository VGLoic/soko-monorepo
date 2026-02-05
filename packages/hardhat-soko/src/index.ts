import "hardhat/types/config";
import { extendConfig, scope } from "hardhat/config";
import { HardhatConfig, HardhatUserConfig } from "hardhat/types/config";
import { z } from "zod";
import { styleText } from "node:util";
import { S3BucketProvider } from "./s3-bucket-provider";
import { LocalStorage } from "./local-storage";
import {
  boxHeader,
  error as cliError,
  info as cliInfo,
  displayListResults,
  displayPullResults,
  displayPushResult,
  displayDifferences,
} from "./cli-ui";
import { SokoHardhatConfig, SokoHardhatUserConfig } from "./config";
import {
  CliError,
  generateArtifactsSummariesAndTypings,
  generateDiffWithTargetRelease,
  listPulledArtifacts,
  pull,
  push,
} from "./cli-client/index";
import { LOG_COLORS } from "./utils";

export { type SokoHardhatUserConfig };

declare module "hardhat/types/config" {
  export interface HardhatUserConfig {
    soko?: SokoHardhatUserConfig;
  }

  export interface HardhatConfig {
    soko?: z.infer<typeof SokoHardhatConfig>;
  }
}

extendConfig(
  (config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
    if (userConfig.soko === undefined) {
      config.soko = undefined;
      return;
    }

    const sokoParsingResult = SokoHardhatConfig.safeParse(userConfig.soko);

    if (!sokoParsingResult.success) {
      console.error(
        styleText(
          LOG_COLORS.warn,
          `Configuration for Soko has been found but seems invalid. Please consult the below errors: \n${sokoParsingResult.error.errors.map(
            (error) => {
              return `  - ${error.path.join(".")}: ${error.message} (${error.code})`;
            },
          )}`,
        ),
      );
      return;
    }

    config.soko = sokoParsingResult.data;
  },
);

const sokoScope = scope("soko", "Soko Hardhat tasks");

sokoScope
  .task("pull", "Pull one or many artifacts of a project.")
  .addFlag(
    "aa",
    `Fake flag - Task description: Pull one or many artifacts of a project.

By default, the project is the one configured in the Hardhat configuration.

One artifact can be pulled by tag
  npx hardhat soko pull --tag v1.2.3
or by ID
  npx hardhat soko pull --id dcauXtavGLxC

All artifacts for a project can be downloaded
  npx hardhat soko pull

A different project can be specified
  npx hardhat soko pull --project another-project

Already downloaded artifacts are not downloaded again by default, enable the force flag to force the download.


`,
  )
  .addOptionalParam(
    "id",
    "The ID of the artifact to pull, can not be used with the `tag` parameter",
  )
  .addOptionalParam(
    "tag",
    "The tag of the artifact to pull, can not be used with the `id` parameter",
  )
  .addOptionalParam(
    "project",
    "The project to pull the artifacts from, defaults to the configured project",
  )
  .addFlag(
    "force",
    "Force the pull of the artifacts, replacing previously downloaded ones",
  )
  .addFlag("debug", "Enable debug mode")
  .setAction(async (opts, hre) => {
    const sokoConfig = hre.config.soko;
    if (!sokoConfig) {
      cliError("Soko is not configured");
      process.exitCode = 1;
      return;
    }

    const optsParsingResult = z
      .object({
        id: z.string().optional(),
        tag: z.string().optional(),
        project: z.string().optional().default(sokoConfig.project),
        force: z.boolean().default(false),
        debug: z.boolean().default(sokoConfig.debug),
      })
      .safeParse(opts);
    if (!optsParsingResult.success) {
      cliError("Invalid arguments");
      if (sokoConfig.debug || opts.debug) {
        console.error(optsParsingResult.error);
      }
      process.exitCode = 1;
      return;
    }

    if (optsParsingResult.data.id && optsParsingResult.data.tag) {
      cliError("The ID and tag parameters can not be used together");
      process.exitCode = 1;
      return;
    }

    if (optsParsingResult.data.id || optsParsingResult.data.tag) {
      boxHeader(
        `Pulling artifact "${optsParsingResult.data.project}:${optsParsingResult.data.id || optsParsingResult.data.tag}"`,
      );
    } else {
      boxHeader(`Pulling artifacts for "${optsParsingResult.data.project}"`);
    }

    const storageProvider = new S3BucketProvider({
      bucketName: sokoConfig.storageConfiguration.awsBucketName,
      bucketRegion: sokoConfig.storageConfiguration.awsRegion,
      accessKeyId: sokoConfig.storageConfiguration.awsAccessKeyId,
      secretAccessKey: sokoConfig.storageConfiguration.awsSecretAccessKey,
      role: sokoConfig.storageConfiguration.awsRole,
    });
    const localStorage = new LocalStorage(sokoConfig.pulledArtifactsPath);
    await pull(
      optsParsingResult.data.project,
      optsParsingResult.data.id || optsParsingResult.data.tag,
      storageProvider,
      localStorage,
      {
        force: optsParsingResult.data.force,
        debug: sokoConfig.debug || optsParsingResult.data.debug,
      },
    )
      .then((result) =>
        displayPullResults(optsParsingResult.data.project, result),
      )
      .catch((err) => {
        if (err instanceof CliError) {
          cliError(err.message);
        } else {
          cliError(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      });
  });

sokoScope
  .task("push", "Push a compilation artifact.")
  .addFlag(
    "aa",
    `Fake flag - Task description: Push a compilation artifact.

The artifact will be stored in the configured project. An identifier is derived for the artifact.
  npx hardhat soko push --artifact-path ./path/to-my-artifact/artifact.jsont

If a tag is provided, the artifact will also be identified by it:
  npx hardhat soko push --artifact-path ./path/to-my-artifact/artifact.json --tag v1.2.3

If the provided tag already exists in the storage, the push will be aborted unless the force flag is enabled.

`,
  )
  .addParam("artifactPath", "The compilation artifact path to push")
  .addOptionalParam("tag", "Tag of the artifact")
  .addFlag(
    "force",
    "Force the push of the artifact even if it already exists in the storage",
  )
  .addFlag("debug", "Enable debug mode")
  .setAction(async (opts, hre) => {
    const sokoConfig = hre.config.soko;
    if (!sokoConfig) {
      cliError("Soko is not configured");
      process.exitCode = 1;
      return;
    }

    const optsParsingResult = z
      .object({
        artifactPath: z.string().min(1),
        tag: z.string().optional(),
        force: z.boolean().default(false),
        debug: z.boolean().default(sokoConfig.debug),
      })
      .safeParse(opts);

    if (!optsParsingResult.success) {
      cliError("Invalid arguments");
      if (sokoConfig.debug || opts.debug) {
        console.error(optsParsingResult.error);
      }
      process.exitCode = 1;
      return;
    }

    boxHeader(
      `Pushing artifact to "${sokoConfig.project}"${optsParsingResult.data.tag ? ` with tag "${optsParsingResult.data.tag}"` : ""}`,
    );

    const storageProvider = new S3BucketProvider({
      bucketName: sokoConfig.storageConfiguration.awsBucketName,
      bucketRegion: sokoConfig.storageConfiguration.awsRegion,
      accessKeyId: sokoConfig.storageConfiguration.awsAccessKeyId,
      secretAccessKey: sokoConfig.storageConfiguration.awsSecretAccessKey,
      role: sokoConfig.storageConfiguration.awsRole,
      debug: optsParsingResult.data.debug,
    });

    await push(
      optsParsingResult.data.artifactPath,
      sokoConfig.project,
      optsParsingResult.data.tag,
      storageProvider,
      {
        force: optsParsingResult.data.force,
        debug: sokoConfig.debug || optsParsingResult.data.debug,
      },
    )
      .then((result) =>
        displayPushResult(
          sokoConfig.project,
          optsParsingResult.data.tag,
          result,
        ),
      )
      .catch((err) => {
        if (err instanceof CliError) {
          cliError(err.message);
        } else {
          cliError(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      });
  });

sokoScope
  .task("typings", "Generate typings based on the existing artifacts.")
  .addFlag(
    "aa",
    `REMIND ME Fake flag - Task description: Generate typings based on the existing artifacts.
The typings will be generated in the configured typings path.

`,
  )
  .addFlag("debug", "Enable debug mode")
  .setAction(async (opts, hre) => {
    const sokoConfig = hre.config.soko;
    if (!sokoConfig) {
      cliError("Soko is not configured");
      process.exitCode = 1;
      return;
    }

    const parsingResult = z
      .object({
        debug: z.boolean().default(sokoConfig.debug),
      })
      .safeParse(opts);

    if (!parsingResult.success) {
      cliError("Invalid arguments");
      if (sokoConfig.debug || opts.debug) {
        console.error(parsingResult.error);
      }
      process.exitCode = 1;
      return;
    }

    boxHeader("Generating typings");

    const localStorage = new LocalStorage(sokoConfig.pulledArtifactsPath);

    await generateArtifactsSummariesAndTypings(
      sokoConfig.typingsPath,
      localStorage,
      {
        debug: parsingResult.data.debug,
      },
    )
      .then(() => {
        console.error("");
      })
      .catch((err) => {
        if (err instanceof CliError) {
          cliError(err.message);
        } else {
          cliError(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      });
  });

sokoScope
  .task(
    "list",
    "List the artifacts that have been pulled with their associated projects.",
  )
  .addFlag("debug", "Enable debug mode")
  .setAction(async (opts, hre) => {
    const sokoConfig = hre.config.soko;
    if (!sokoConfig) {
      cliError("Soko is not configured");
      process.exitCode = 1;
      return;
    }

    const parsingResult = z
      .object({
        debug: z.boolean().default(sokoConfig.debug),
      })
      .safeParse(opts);

    if (!parsingResult.success) {
      cliError("Invalid arguments");
      if (sokoConfig.debug || opts.debug) {
        console.error(parsingResult.error);
      }
      process.exitCode = 1;
      return;
    }

    boxHeader("Listing artifacts");

    const localStorage = new LocalStorage(sokoConfig.pulledArtifactsPath);

    await listPulledArtifacts(localStorage, {
      debug: parsingResult.data.debug,
    })
      .then(displayListResults)
      .catch((err) => {
        if (err instanceof CliError) {
          cliError(err.message);
        } else {
          cliError(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      });
  });

sokoScope
  .task(
    "diff",
    "Compare a local compilation artifacts with an existing release.",
  )
  .addParam("artifactPath", "The compilation artifact path to compare")
  .addOptionalParam(
    "id",
    "The ID of the artifact to compare with, can not be used with the `tag` parameter",
  )
  .addOptionalParam(
    "tag",
    "The tag of the artifact to compare with, can not be used with the `id` parameter",
  )
  .addFlag("debug", "Enable debug mode")
  .setAction(async (opts, hre) => {
    const sokoConfig = hre.config.soko;
    if (!sokoConfig) {
      cliError("Soko is not configured");
      process.exitCode = 1;
      return;
    }

    const paramParsingResult = z
      .object({
        artifactPath: z.string().min(1),
        id: z.string().optional(),
        tag: z.string().optional(),
        debug: z.boolean().default(sokoConfig.debug),
      })
      .safeParse(opts);
    if (!paramParsingResult.success) {
      cliError("Invalid arguments");
      if (sokoConfig.debug || opts.debug) {
        console.error(paramParsingResult.error);
      }
      process.exitCode = 1;
      return;
    }
    if (paramParsingResult.data.id && paramParsingResult.data.tag) {
      cliError("The ID and tag parameters can not be used together");
      process.exitCode = 1;
      return;
    }

    if (!paramParsingResult.data.id && !paramParsingResult.data.tag) {
      cliError("The artifact must be identified by a tag or an ID");
      process.exitCode = 1;
      return;
    }

    const tagOrId = paramParsingResult.data.id || paramParsingResult.data.tag;
    if (!tagOrId) {
      cliError("The artifact must be identified by a tag or an ID");
      process.exitCode = 1;
      return;
    }

    boxHeader(`Comparing with artifact "${sokoConfig.project}:${tagOrId}"`);

    const localStorage = new LocalStorage(sokoConfig.pulledArtifactsPath);

    await generateDiffWithTargetRelease(
      paramParsingResult.data.artifactPath,
      { project: sokoConfig.project, tagOrId },
      localStorage,
      {
        debug: paramParsingResult.data.debug,
      },
    )
      .then(displayDifferences)
      .catch((err) => {
        if (err instanceof CliError) {
          cliError(err.message);
        } else {
          cliError(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      });
  });

sokoScope
  .task("help", "Use `npx hardhat help soko` instead")
  .setAction(async () => {
    cliInfo(
      "This help format is not supported by Hardhat.\nPlease use `npx hardhat help soko` instead (change `npx` with what you use).\nHelp on a specific task can be obtained by using `npx hardhat help soko <command>`.",
    );
  });
