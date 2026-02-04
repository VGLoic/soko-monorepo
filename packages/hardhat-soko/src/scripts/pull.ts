import { toAsyncResult } from "../utils";
import { ScriptError } from "../utils";
import { StorageProvider } from "../s3-bucket-provider";
import { LocalStorage } from "../local-storage";
import { StepTracker } from "../cli-ui";

/**
 * Pulls artifacts of a project from the storage provider
 * @param project The project name
 * @param tagOrId The tag or ID of the artifact to pull
 * @param opts.force Whether to force the pull
 * @param opts.release A specific release to pull
 * @param opts.debug Whether to enable debug mode
 * @param localStorage The local storage
 * @param storageProvider The storage provider
 * @returns An object with the remote releases, pulled releases, and failed releases
 */
export async function pull(
  project: string,
  tagOrId: string | undefined,
  opts: { force: boolean; debug: boolean },
  localStorage: LocalStorage,
  storageProvider: StorageProvider,
) {
  const steps = new StepTracker(3);

  // Step 1: Fetch remote artifacts
  steps.start("Fetching remote artifact list...");
  const remoteListingResult = await toAsyncResult(
    Promise.all([
      storageProvider.listTags(project),
      storageProvider.listIds(project),
    ]),
    { debug: opts.debug },
  );
  if (!remoteListingResult.success) {
    steps.fail("Failed to fetch remote artifacts");
    throw new ScriptError("Error listing the remote tags and IDs");
  }
  const [remoteTags, remoteIds] = remoteListingResult.value;
  steps.succeed("Fetched remote artifact list");

  const tagsToDownload: string[] = [];
  const idsToDownload: string[] = [];

  if (tagOrId) {
    if (remoteTags.includes(tagOrId)) {
      tagsToDownload.push(tagOrId);
    } else if (remoteIds.includes(tagOrId)) {
      idsToDownload.push(tagOrId);
    } else {
      throw new ScriptError(
        `The tag or ID "${tagOrId}" does not exist in the storage`,
      );
    }
  } else {
    tagsToDownload.push(...remoteTags);
    idsToDownload.push(...remoteIds);
  }

  // Step 2: Check local artifacts
  steps.start("Checking local artifacts...");
  let filteredTagsToDownload: string[] = [];
  let filteredIdsToDownload: string[] = [];
  if (opts.force) {
    filteredTagsToDownload = tagsToDownload;
    filteredIdsToDownload = idsToDownload;
    steps.succeed("Skipped (force mode)");
  } else {
    const localListingResult = await toAsyncResult(
      Promise.all([
        localStorage.listTags(project).then((tagMetadatas) => {
          const tags = new Set<string>();
          for (const tagMetadata of tagMetadatas) {
            tags.add(tagMetadata.tag);
          }
          return tags;
        }),
        localStorage.listIds(project).then((idMetadatas) => {
          const ids = new Set<string>();
          for (const idMetadata of idMetadatas) {
            ids.add(idMetadata.id);
          }
          return ids;
        }),
      ]),
      { debug: opts.debug },
    );
    if (!localListingResult.success) {
      steps.fail("Failed to check local artifacts");
      throw new ScriptError("Error listing the local tags and IDs");
    }

    const [localTags, localIds] = localListingResult.value;

    filteredTagsToDownload = tagsToDownload.filter(
      (tag) => !localTags.has(tag),
    );
    filteredIdsToDownload = idsToDownload.filter((id) => !localIds.has(id));
    steps.succeed("Checked local artifacts");
  }

  // Step 3: Download artifacts
  if (
    filteredTagsToDownload.length === 0 &&
    filteredIdsToDownload.length === 0
  ) {
    steps.start("Checking for updates...");
    steps.succeed("All artifacts are up to date");
    return {
      remoteTags,
      remoteIds,
      pulledTags: [],
      pulledIds: [],
      failedTags: [],
      failedIds: [],
    };
  }

  const missingArtifactCount =
    filteredTagsToDownload.length + filteredIdsToDownload.length;
  steps.start(
    `Downloading ${missingArtifactCount} missing artifact${missingArtifactCount > 1 ? "s" : ""}...`,
  );

  const tagsPromises: Promise<{ tag: string }>[] = filteredTagsToDownload.map(
    async (tag) => {
      const downloadResult = await toAsyncResult(
        storageProvider.downloadArtifactByTag(project, tag),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new ScriptError(`Error downloading the tag "${tag}"`);
      }

      const createResult = await toAsyncResult(
        localStorage.createArtifactByTag(project, tag, downloadResult.value),
        { debug: opts.debug },
      );
      if (!createResult.success) {
        throw new ScriptError(`Error creating the tag "${tag}"`);
      }

      return { tag };
    },
  );
  const idsPromises: Promise<{ id: string }>[] = filteredIdsToDownload.map(
    async (id) => {
      const downloadResult = await toAsyncResult(
        storageProvider.downloadArtifactById(project, id),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new ScriptError(`Error downloading the ID "${id}"`);
      }

      const createResult = await toAsyncResult(
        localStorage.createArtifactById(project, id, downloadResult.value),
        { debug: opts.debug },
      );
      if (!createResult.success) {
        throw new ScriptError(`Error creating the ID "${id}"`);
      }

      return { id };
    },
  );

  const tagsSettlements = await Promise.allSettled(tagsPromises);
  const pulledTags = new Set();
  for (const settlement of tagsSettlements) {
    if (settlement.status === "fulfilled") {
      pulledTags.add(settlement.value.tag);
    }
  }
  const failedTags = filteredTagsToDownload.filter(
    (tag) => !pulledTags.has(tag),
  );

  const idsSettlements = await Promise.allSettled(idsPromises);
  const pulledIds = new Set();
  for (const settlement of idsSettlements) {
    if (settlement.status === "fulfilled") {
      pulledIds.add(settlement.value.id);
    }
  }
  const failedIds = filteredIdsToDownload.filter((id) => !pulledIds.has(id));

  const totalPulled = pulledTags.size + pulledIds.size;
  const totalFailed = failedTags.length + failedIds.length;

  if (totalFailed > 0) {
    steps.fail(
      `Downloaded ${totalPulled} artifact${totalPulled > 1 ? "s" : ""}, ${totalFailed} failed`,
    );
  } else {
    steps.succeed(
      `Downloaded ${totalPulled} artifact${totalPulled > 1 ? "s" : ""} successfully`,
    );
  }

  return {
    remoteTags,
    remoteIds,
    pulledTags: Array.from(pulledTags),
    pulledIds: Array.from(pulledIds),
    failedTags,
    failedIds,
  };
}
