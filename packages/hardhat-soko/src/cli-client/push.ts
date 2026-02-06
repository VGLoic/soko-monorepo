import { StorageProvider } from "../s3-bucket-provider";
import { StepTracker } from "../cli-ui";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";
import { lookForBuildInfoJsonFile } from "./helpers/look-for-build-info-json-file";
import { mapBuildInfoToSokoArtifact } from "./helpers/map-build-info-to-soko-artifact";
import { HARDHAT_COMPILER_OUTPUT_FORMAT } from "@/utils/artifacts-schemas/hardhat-v2";
import {
  FORGE_COMPILER_DEFAULT_OUTPUT_FORMAT,
  FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT,
} from "@/utils/artifacts-schemas/forge-v1";
import { SokoArtifact } from "@/utils/artifacts-schemas/soko-v0";

const PARSING_SUCCESS_TEXT: Record<SokoArtifact["origin"]["_format"], string> =
  {
    [HARDHAT_COMPILER_OUTPUT_FORMAT]: "Hardhat compilation artifact detected",
    [FORGE_COMPILER_OUTPUT_WITH_BUILD_INFO_OPTION_FORMAT]:
      "Forge compilation artifact detected",
    [FORGE_COMPILER_DEFAULT_OUTPUT_FORMAT]:
      "Forge compilation artifact detected",
  };

/**
 * Run the push command of the CLI client, it consists of three steps:
 * 1. Read the compilation artifact from the provided path and validate it
 * 2. If a tag is provided, check if it already exists in the storage and handle it based on the force option
 * 3. Upload the artifact to the storage with the provided project, tag, and a generated ID based on the artifact content
 *
 * The method returns the generated artifact ID.
 *
 * @throws CliError if there is an error reading the artifact, checking the tag existence, or uploading the artifact. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param artifactPath The path to the compilation artifact to push
 * @param project The project name
 * @param tag The tag to associate with the artifact, if any
 * @param storageProvider The storage provider used to upload artifacts
 * @param opts Options for the push command, currently only supports the force option to skip the check of existing tag in the storage
 * @returns The generated artifact ID
 */
export async function push(
  artifactPath: string,
  project: string,
  tag: string | undefined,
  storageProvider: StorageProvider,
  opts: { force: boolean; debug: boolean },
): Promise<string> {
  const steps = new StepTracker(4);

  // Step 1: Look for compilation artifact
  steps.start("Looking for compilation artifact...");
  const buildInfoPathResult = await toAsyncResult(
    lookForBuildInfoJsonFile(artifactPath, opts.debug),
  );
  if (!buildInfoPathResult.success) {
    steps.fail("Failed to find compilation artifact");
    // @dev the lookForBuildInfoJsonFile function throws a CliError with a user-friendly message, so we can directly re-throw it here without wrapping it in another error or modifying the message
    throw buildInfoPathResult.error;
  }
  steps.succeed(`Compilation artifact found at ${buildInfoPathResult.value}`);

  // Step 2: Parse the compilation artifact, mapping it to the Soko format
  steps.start("Analyzing compilation artifact...");
  const sokoArtifactParsingResult = await toAsyncResult(
    mapBuildInfoToSokoArtifact(buildInfoPathResult.value, opts.debug),
  );
  if (!sokoArtifactParsingResult.success) {
    steps.fail("Unable to handle the provided compilation artifact");
    // @dev the mapBuildInfoToSokoArtifact function throws an Error with a user-friendly message, so we can directly re-throw it here without wrapping it in another error or modifying the message
    throw sokoArtifactParsingResult.error;
  }
  const sokoArtifact = sokoArtifactParsingResult.value.artifact;
  steps.succeed(PARSING_SUCCESS_TEXT[sokoArtifact.origin._format]);

  // Step 3: Check if tag exists
  steps.start("Checking if tag exists...");
  if (!tag) {
    steps.succeed("No tag provided, skipping tag existence check");
  } else {
    const hasTagResult = await toAsyncResult(
      storageProvider.hasArtifactByTag(project, tag),
      { debug: opts.debug },
    );
    if (!hasTagResult.success) {
      steps.fail("Failed to check tag existence");
      throw new CliError(
        `Error checking if the tag "${tag}" exists on the storage, please check the storage configuration or run with debug mode for more info`,
      );
    }
    if (hasTagResult.value) {
      if (!opts.force) {
        steps.fail("Tag already exists");
        throw new CliError(
          `The tag "${tag}" already exists on the storage. Please, make sure to use a different tag.`,
        );
      } else {
        steps.warn(`Tag "${tag}" already exists, forcing push`);
      }
    } else {
      steps.succeed("Tag is available");
    }
  }

  // Step 4: Upload artifact
  steps.start("Uploading artifact...");
  const pushResult = await toAsyncResult(
    storageProvider.uploadArtifact(project, sokoArtifact, tag, {
      buildInfoPath: buildInfoPathResult.value,
      additionalArtifactsPaths:
        sokoArtifactParsingResult.value.additionalArtifactsPaths,
    }),
    { debug: opts.debug },
  );

  if (!pushResult.success) {
    steps.fail("Failed to upload artifact");
    throw new CliError(
      `Error pushing the artifact "${project}:${tag || sokoArtifact.id}" to the storage, please check the storage configuration or run with debug mode for more info`,
    );
  }
  steps.succeed("Artifact uploaded successfully");

  return sokoArtifact.id;
}
