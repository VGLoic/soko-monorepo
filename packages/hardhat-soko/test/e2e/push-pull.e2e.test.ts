import fs from "fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { pushArtifact } from "@/scripts/push";
import { pull } from "@/scripts/pull";
import { createTestS3Provider } from "@test/helpers/s3-provider-factory";
import { createTestLocalProvider } from "@test/helpers/local-provider-factory";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import type { S3BucketProvider } from "@/s3-bucket-provider";
import type { LocalStorageProvider } from "@/scripts/local-storage-provider";

describe("Push-Pull E2E Tests", () => {
  let storageProvider: S3BucketProvider;
  let localProvider: LocalStorageProvider;
  let localProviderCleanup: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    storageProvider = createTestS3Provider();
    const localSetup = await createTestLocalProvider();
    localProvider = localSetup.provider;
    localProviderCleanup = localSetup.cleanup;
  });

  afterEach(async () => {
    if (localProviderCleanup) {
      await localProviderCleanup();
      localProviderCleanup = null;
    }
  });

  test("push artifact without tag → pull by ID", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
    const artifactPath = TEST_CONSTANTS.PATHS.SAMPLE_ARTIFACT;

    await localProvider.ensureProjectSetup(project);

    const artifactId = await pushArtifact(
      artifactPath,
      project,
      undefined,
      { force: false, debug: false },
      storageProvider,
    );

    expect(artifactId).toBeTruthy();
    expect(artifactId).toHaveLength(12);

    const hasArtifact = await storageProvider.hasArtifactById(
      project,
      artifactId,
    );
    expect(hasArtifact).toBe(true);

    const pullResult = await pull(
      project,
      artifactId,
      { force: false, debug: false },
      localProvider,
      storageProvider,
    );

    expect(pullResult.pulledIds).toContain(artifactId);
    expect(pullResult.failedIds).toHaveLength(0);

    const hasLocal = await localProvider.hasId(project, artifactId);
    expect(hasLocal).toBe(true);

    const localArtifact = await localProvider.retrieveArtifactById(
      project,
      artifactId,
    );
    const originalContent = await fs.readFile(artifactPath, "utf-8");
    const originalJson = JSON.parse(originalContent) as { id: string };

    expect(localArtifact.id).toBe(originalJson.id);
  });

  test("push artifact with tag → pull by tag", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
    const tag = TEST_CONSTANTS.TAGS.V1;
    const artifactPath = TEST_CONSTANTS.PATHS.SAMPLE_ARTIFACT;

    await localProvider.ensureProjectSetup(project);

    const artifactId = await pushArtifact(
      artifactPath,
      project,
      tag,
      { force: false, debug: false },
      storageProvider,
    );

    const hasTag = await storageProvider.hasArtifactByTag(project, tag);
    const hasId = await storageProvider.hasArtifactById(project, artifactId);
    expect(hasTag).toBe(true);
    expect(hasId).toBe(true);

    const pullResult = await pull(
      project,
      tag,
      { force: false, debug: false },
      localProvider,
      storageProvider,
    );

    expect(pullResult.pulledTags).toContain(tag);
    expect(pullResult.failedTags).toHaveLength(0);

    const hasLocalTag = await localProvider.hasTag(project, tag);
    expect(hasLocalTag).toBe(true);

    const localArtifact = await localProvider.retrieveArtifactByTag(
      project,
      tag,
    );
    expect(localArtifact).toBeTruthy();
  });

  test("pull all artifacts for a project", async () => {
    const project = createTestProjectName(
      TEST_CONSTANTS.PROJECTS.MULTI_ARTIFACT,
    );
    const artifactPath = TEST_CONSTANTS.PATHS.SAMPLE_ARTIFACT;

    await localProvider.ensureProjectSetup(project);

    const tag1 = TEST_CONSTANTS.TAGS.V1;
    const tag2 = TEST_CONSTANTS.TAGS.V2;

    await pushArtifact(
      artifactPath,
      project,
      tag1,
      { force: false, debug: false },
      storageProvider,
    );
    await pushArtifact(
      artifactPath,
      project,
      tag2,
      { force: true, debug: false },
      storageProvider,
    );

    const pullResult = await pull(
      project,
      undefined,
      { force: false, debug: false },
      localProvider,
      storageProvider,
    );

    expect(pullResult.pulledTags).toHaveLength(2);
    expect(pullResult.pulledTags).toContain(tag1);
    expect(pullResult.pulledTags).toContain(tag2);
  });

  test("force push overwrites existing tag", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.FORCE_TEST);
    const tag = TEST_CONSTANTS.TAGS.LATEST;
    const artifactPath = TEST_CONSTANTS.PATHS.SAMPLE_ARTIFACT;

    await localProvider.ensureProjectSetup(project);

    const id1 = await pushArtifact(
      artifactPath,
      project,
      tag,
      { force: false, debug: false },
      storageProvider,
    );

    await expect(
      pushArtifact(
        artifactPath,
        project,
        tag,
        { force: false, debug: false },
        storageProvider,
      ),
    ).rejects.toThrow(/already exists/);

    const id2 = await pushArtifact(
      artifactPath,
      project,
      tag,
      { force: true, debug: false },
      storageProvider,
    );

    expect(id1).toBe(id2);

    const hasTag = await storageProvider.hasArtifactByTag(project, tag);
    expect(hasTag).toBe(true);
  });

  test("pull with force re-downloads existing artifacts", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
    const tag = TEST_CONSTANTS.TAGS.V1;
    const artifactPath = TEST_CONSTANTS.PATHS.SAMPLE_ARTIFACT;

    await localProvider.ensureProjectSetup(project);

    await pushArtifact(
      artifactPath,
      project,
      tag,
      { force: false, debug: false },
      storageProvider,
    );
    await pull(
      project,
      tag,
      { force: false, debug: false },
      localProvider,
      storageProvider,
    );

    const result1 = await pull(
      project,
      tag,
      { force: false, debug: false },
      localProvider,
      storageProvider,
    );
    expect(result1.pulledTags).toHaveLength(0);

    const result2 = await pull(
      project,
      tag,
      { force: true, debug: false },
      localProvider,
      storageProvider,
    );
    expect(result2.pulledTags).toContain(tag);
  });

  test("pull non-existent artifact returns error", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

    await localProvider.ensureProjectSetup(project);

    await expect(
      pull(
        project,
        "non-existent-tag",
        { force: false, debug: false },
        localProvider,
        storageProvider,
      ),
    ).rejects.toThrow();
  });

  test("list operations work correctly", async () => {
    const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
    const artifactPath = TEST_CONSTANTS.PATHS.SAMPLE_ARTIFACT;

    await localProvider.ensureProjectSetup(project);

    const tag1 = TEST_CONSTANTS.TAGS.V1;
    const tag2 = TEST_CONSTANTS.TAGS.V2;

    const id1 = await pushArtifact(
      artifactPath,
      project,
      tag1,
      { force: false, debug: false },
      storageProvider,
    );
    await pushArtifact(
      artifactPath,
      project,
      tag2,
      { force: true, debug: false },
      storageProvider,
    );

    const remoteTags = await storageProvider.listTags(project);
    expect(remoteTags).toHaveLength(2);
    expect(remoteTags).toContain(tag1);
    expect(remoteTags).toContain(tag2);

    const remoteIds = await storageProvider.listIds(project);
    expect(remoteIds).toHaveLength(1);
    expect(remoteIds).toContain(id1);
  });
});
