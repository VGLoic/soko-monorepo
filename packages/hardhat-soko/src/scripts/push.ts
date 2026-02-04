import { StorageProvider } from "../s3-bucket-provider";
import { toAsyncResult } from "../utils";
import { retrieveFreshCompilationArtifact, ScriptError } from "../utils";
import crypto from "crypto";
import { StepTracker } from "../cli-ui";

export async function pushArtifact(
  artifactPath: string,
  project: string,
  tag: string | undefined,
  opts: {
    force: boolean;
    debug: boolean;
  },
  storageProvider: StorageProvider,
) {
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
    throw new ScriptError(`Error retrieving the compilation artifact`);
  }

  if (freshBuildInfoResult.value.status === "error") {
    steps.fail("Failed to read compilation artifact");
    throw new ScriptError(
      `Error retrieving the compilation artifact. ${freshBuildInfoResult.value.reason}`,
    );
  }
  steps.succeed("Compilation artifact read");

  // Step 2: Check if tag exists
  if (tag) {
    steps.start("Checking if tag exists...");
    const hasTagResult = await toAsyncResult(
      storageProvider.hasArtifactByTag(project, tag),
      { debug: opts.debug },
    );
    if (!hasTagResult.success) {
      steps.fail("Failed to check tag existence");
      throw new ScriptError(
        `Error checking if the tag "${tag}" exists on the storage`,
      );
    }
    if (hasTagResult.value) {
      if (!opts.force) {
        steps.fail("Tag already exists");
        throw new ScriptError(
          `The tag "${tag}" already exists on the storage. Please, make sure to use a different tag name.`,
        );
      } else {
        steps.warn(`Tag "${tag}" already exists, forcing push`);
      }
    } else {
      steps.succeed("Tag is available");
    }
  }

  const hash = crypto.createHash("sha256");
  hash.update(freshBuildInfoResult.value.content);
  const checksum = hash.digest("hex");
  const artifactId = checksum.substring(0, 12);

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
    throw new ScriptError(
      `Error pushing the artifact "${project}:${tag || artifactId}" to the storage`,
    );
  }
  steps.succeed("Artifact uploaded successfully");

  return artifactId;
}
