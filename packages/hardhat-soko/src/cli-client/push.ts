import { StorageProvider } from "../s3-bucket-provider";
import { StepTracker } from "../cli-ui";
import { retrieveFreshCompilationArtifact } from "../utils/artifact-parsing";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";

import crypto from "crypto";

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
  const steps = new StepTracker(3);

  // Step 1: Read compilation artifact
  steps.start("Reading compilation artifact...");
  const freshBuildInfoResult = await toAsyncResult(
    retrieveFreshCompilationArtifact(artifactPath),
    {
      debug: opts.debug,
    },
  );
  if (!freshBuildInfoResult.success) {
    steps.fail("Failed to read compilation artifact");
    throw new CliError(
      "Error retrieving the compilation artifact, please check if the path contains a valid compilation artifact. Run with debug mode for more info",
    );
  }

  if (freshBuildInfoResult.value.status === "error") {
    steps.fail("Failed to read compilation artifact");
    throw new CliError(
      `Error retrieving the compilation artifact. ${freshBuildInfoResult.value.reason}`,
    );
  }
  steps.succeed("Compilation artifact read");

  // Step 2: Check if tag exists
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

  const artifactId = deriveArtifactSokoId(freshBuildInfoResult.value.content);

  // Step 3: Upload artifact
  steps.start("Uploading artifact...");
  const pushResult = await toAsyncResult(
    storageProvider.uploadArtifact(
      project,
      artifactId,
      tag,
      freshBuildInfoResult.value.content,
    ),
    { debug: opts.debug },
  );

  if (!pushResult.success) {
    steps.fail("Failed to upload artifact");
    throw new CliError(
      `Error pushing the artifact "${project}:${tag || artifactId}" to the storage, please check the storage configuration or run with debug mode for more info`,
    );
  }
  steps.succeed("Artifact uploaded successfully");

  return artifactId;
}

function deriveArtifactSokoId(artifactContent: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(artifactContent);
  const checksum = hash.digest("hex");
  return checksum.substring(0, 12);
}
