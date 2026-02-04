import "hardhat/types/config";
import { extendConfig, scope } from "hardhat/config";
import { HardhatConfig, HardhatUserConfig } from "hardhat/types/config";
import { z } from "zod";
import { styleText } from "node:util";
import { ScriptError, toAsyncResult } from "./utils";
import { S3BucketProvider } from "./s3-bucket-provider";
import { pull } from "./scripts/pull";
import { generateArtifactsSummariesAndTypings } from "./scripts/generate-typings";
import { pushArtifact } from "./scripts/push";
import { LocalStorage } from "./local-storage";
import { generateStructuredDataForArtifacts } from "./scripts/list";
import { generateDiffWithTargetRelease } from "./scripts/diff";
import {
  boxHeader,
  boxSummary,
  createSpinner,
  error as cliError,
  success as cliSuccess,
  warn as cliWarn,
  colorTableHeaders,
  info as cliInfo,
} from "./cli-ui";

/**
 * The Soko Hardhat user configuration
 */
export type SokoHardhatUserConfig = {
  /**
   * The project name
   */
  project: string;
  /**
   * The local path in which artifacts will be pulled
   *
   * Default to `.soko`
   */
  pulledArtifactsPath?: string;
  /**
   * The local path in which typings will be generated
   *
   * Default to `.soko-typings`
   */
  typingsPath?: string;
  /**
   * Configuration of the storage where the artifacts will be stored
   *
   * Only AWS is supported for now
   */
  storageConfiguration: {
    type: "aws";
    awsRegion: string;
    awsBucketName: string;
    awsAccessKeyId: string;
    awsSecretAccessKey: string;
    awsRole?: {
      roleArn: string;
      externalId?: string;
      sessionName?: string;
      durationSeconds?: number;
    };
  };
  /**
   * Enable debug mode for all tasks
   *
   * Default to `false`
   */
  debug?: boolean;
};

const SokoHardhatConfig = z.object({
  project: z.string().min(1),
  pulledArtifactsPath: z.string().default(".soko"),
  typingsPath: z.string().default(".soko-typings"),
  storageConfiguration: z.object({
    type: z.literal("aws"),
    awsRegion: z.string().min(1),
    awsBucketName: z.string().min(1),
    awsAccessKeyId: z.string().min(1),
    awsSecretAccessKey: z.string().min(1),
    awsRole: z
      .object({
        roleArn: z.string().min(1),
        externalId: z.string().min(1).optional(),
        sessionName: z.string().min(1).default("soko-hardhat-session"),
        durationSeconds: z.number().int().min(900).max(43200).default(3600),
      })
      .optional(),
  }),
  debug: z.boolean().default(false),
});

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
          "yellow",
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
      debug: optsParsingResult.data.debug,
    });

    const localStorage = new LocalStorage(sokoConfig.pulledArtifactsPath);

    const setupSpinner = createSpinner("Setting up local storage...");
    const ensureResult = await toAsyncResult(
      localStorage.ensureProjectSetup(optsParsingResult.data.project),
      { debug: optsParsingResult.data.debug },
    );
    if (!ensureResult.success) {
      setupSpinner.fail("Failed to setup local storage");
      if (ensureResult.error instanceof ScriptError) {
        cliError(ensureResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(ensureResult.error);
      process.exitCode = 1;
      return;
    }
    setupSpinner.succeed("Local storage ready");

    const pullResult = await toAsyncResult(
      pull(
        optsParsingResult.data.project,
        optsParsingResult.data.id || optsParsingResult.data.tag,
        {
          debug: optsParsingResult.data.debug,
          force: optsParsingResult.data.force,
        },
        localStorage,
        storageProvider,
      ),
      { debug: optsParsingResult.data.debug },
    );
    if (!pullResult.success) {
      if (pullResult.error instanceof ScriptError) {
        cliError(pullResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(pullResult.error);
      process.exitCode = 1;
      return;
    }

    if (
      pullResult.value.remoteTags.length === 0 &&
      pullResult.value.remoteIds.length === 0
    ) {
      cliSuccess("No artifacts to pull yet");
    } else if (
      pullResult.value.failedTags.length === 0 &&
      pullResult.value.failedIds.length === 0 &&
      pullResult.value.pulledTags.length === 0 &&
      pullResult.value.pulledIds.length === 0
    ) {
      cliSuccess(
        `You're up to date with project "${optsParsingResult.data.project}"`,
      );
    } else {
      const summaryLines: string[] = [];

      if (pullResult.value.pulledTags.length > 0) {
        summaryLines.push(styleText(["bold", "green"], "✔ Pulled Tags:"));
        pullResult.value.pulledTags.forEach((tag) => {
          summaryLines.push(styleText("green", `  • ${tag}`));
        });
      }
      if (pullResult.value.pulledIds.length > 0) {
        if (summaryLines.length > 0) summaryLines.push("");
        summaryLines.push(styleText(["bold", "green"], "✔ Pulled IDs:"));
        pullResult.value.pulledIds.forEach((id) => {
          summaryLines.push(styleText("green", `  • ${id}`));
        });
      }
      if (pullResult.value.failedTags.length > 0) {
        if (summaryLines.length > 0) summaryLines.push("");
        summaryLines.push(styleText(["bold", "red"], "✖ Failed Tags:"));
        pullResult.value.failedTags.forEach((tag) => {
          summaryLines.push(styleText("red", `  • ${tag}`));
        });
      }
      if (pullResult.value.failedIds.length > 0) {
        if (summaryLines.length > 0) summaryLines.push("");
        summaryLines.push(styleText(["bold", "red"], "✖ Failed IDs:"));
        pullResult.value.failedIds.forEach((id) => {
          summaryLines.push(styleText("red", `  • ${id}`));
        });
      }

      if (summaryLines.length > 0) {
        boxSummary("Summary", summaryLines);
      }
    }
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

    const localStorage = new LocalStorage(sokoConfig.pulledArtifactsPath);

    const ensureResult = await toAsyncResult(
      localStorage.ensureProjectSetup(sokoConfig.project),
      { debug: optsParsingResult.data.debug },
    );
    if (!ensureResult.success) {
      if (ensureResult.error instanceof ScriptError) {
        cliError(ensureResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(ensureResult.error);
      process.exitCode = 1;
      return;
    }

    const pushResult = await toAsyncResult(
      pushArtifact(
        optsParsingResult.data.artifactPath,
        sokoConfig.project,
        optsParsingResult.data.tag,
        {
          debug: optsParsingResult.data.debug,
          force: optsParsingResult.data.force,
        },
        storageProvider,
      ),
      { debug: optsParsingResult.data.debug },
    );
    if (!pushResult.success) {
      if (pushResult.error instanceof ScriptError) {
        cliError(pushResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(pushResult.error);
      process.exitCode = 1;
      return;
    }

    console.error("");
    cliSuccess(
      `Artifact "${sokoConfig.project}:${optsParsingResult.data.tag || pushResult.value}" pushed successfully`,
    );
    console.error(styleText("cyan", `  ID: ${pushResult.value}`));
    console.error("");
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

    const setupSpinner = createSpinner("Setting up local storage...");
    const ensureResult = await toAsyncResult(localStorage.ensureSetup(), {
      debug: parsingResult.data.debug,
    });
    if (!ensureResult.success) {
      setupSpinner.fail("Failed to setup local storage");
      if (ensureResult.error instanceof ScriptError) {
        cliError(ensureResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(ensureResult.error);
      process.exitCode = 1;
      return;
    }
    setupSpinner.succeed("Local storage ready");

    const generateSpinner = createSpinner("Generating typings...");
    await generateArtifactsSummariesAndTypings(
      sokoConfig.typingsPath,
      false,
      {
        debug: parsingResult.data.debug,
      },
      localStorage,
    )
      .then(() => {
        generateSpinner.succeed("Typings generated successfully");
        console.error("");
      })
      .catch((err) => {
        generateSpinner.fail("Failed to generate typings");
        if (err instanceof ScriptError) {
          cliError(err.message);
          process.exitCode = 1;
          return;
        }
        cliError("An unexpected error occurred");
        console.error(err);
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

    const setupResult = await toAsyncResult(localStorage.ensureSetup(), {
      debug: parsingResult.data.debug,
    });
    if (!setupResult.success) {
      if (setupResult.error instanceof ScriptError) {
        cliError(setupResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(setupResult.error);
      process.exitCode = 1;
      return;
    }

    const structuredDataResult = await toAsyncResult(
      generateStructuredDataForArtifacts(localStorage, {
        debug: parsingResult.data.debug,
      }),
      { debug: parsingResult.data.debug },
    );
    if (!structuredDataResult.success) {
      if (structuredDataResult.error instanceof ScriptError) {
        cliError(structuredDataResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(structuredDataResult.error);
      process.exitCode = 1;
      return;
    }

    if (structuredDataResult.value.length === 0) {
      cliWarn("No artifacts found");
      return;
    }

    colorTableHeaders(structuredDataResult.value, [
      "Project",
      "Tag",
      "ID",
      "Pull date",
    ]);
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

    const ensureSpinner = createSpinner("Setting up local storage...");
    const ensureResult = await toAsyncResult(
      localStorage.ensureProjectSetup(sokoConfig.project),
      { debug: paramParsingResult.data.debug },
    );
    if (!ensureResult.success) {
      ensureSpinner.fail("Failed to setup local storage");
      if (ensureResult.error instanceof ScriptError) {
        cliError(ensureResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(ensureResult.error);
      process.exitCode = 1;
      return;
    }
    ensureSpinner.succeed("Local storage ready");

    const compareSpinner = createSpinner("Comparing artifacts...");
    const differencesResult = await toAsyncResult(
      generateDiffWithTargetRelease(
        paramParsingResult.data.artifactPath,
        { project: sokoConfig.project, tagOrId },
        {
          debug: paramParsingResult.data.debug,
        },
        localStorage,
      ),
    );
    if (!differencesResult.success) {
      compareSpinner.fail("Failed to compare artifacts");
      if (differencesResult.error instanceof ScriptError) {
        cliError(differencesResult.error.message);
        process.exitCode = 1;
        return;
      }
      cliError("An unexpected error occurred");
      console.error(differencesResult.error);
      process.exitCode = 1;
      return;
    }
    compareSpinner.succeed("Comparison complete");

    if (differencesResult.value.length === 0) {
      console.error("");
      cliSuccess("No differences found");
      console.error("");
      return;
    }

    const added = differencesResult.value.filter((d) => d.status === "added");
    const removed = differencesResult.value.filter(
      (d) => d.status === "removed",
    );
    const changed = differencesResult.value.filter(
      (d) => d.status === "changed",
    );

    const summaryLines: string[] = [];

    if (changed.length > 0) {
      summaryLines.push(styleText(["bold", "yellow"], "Changed:"));
      changed.forEach((diff) => {
        summaryLines.push(
          styleText("yellow", `  • ${diff.name} (${diff.path})`),
        );
      });
    }

    if (added.length > 0) {
      if (summaryLines.length > 0) summaryLines.push("");
      summaryLines.push(styleText(["bold", "green"], "Added:"));
      added.forEach((diff) => {
        summaryLines.push(
          styleText("green", `  • ${diff.name} (${diff.path})`),
        );
      });
    }

    if (removed.length > 0) {
      if (summaryLines.length > 0) summaryLines.push("");
      summaryLines.push(styleText(["bold", "red"], "Removed:"));
      removed.forEach((diff) => {
        summaryLines.push(styleText("red", `  • ${diff.name} (${diff.path})`));
      });
    }

    boxSummary("Differences Found", summaryLines);
  });

sokoScope
  .task("help", "Use `npx hardhat help soko` instead")
  .setAction(async () => {
    cliInfo(
      "This help format is not supported by Hardhat.\nPlease use `npx hardhat help soko` instead (change `npx` with what you use).\nHelp on a specific task can be obtained by using `npx hardhat help soko <command>`.",
    );
  });
