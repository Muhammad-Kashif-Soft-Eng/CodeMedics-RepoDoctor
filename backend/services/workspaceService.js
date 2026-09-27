'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getRepoInfo, getRepoTree, getFileContent, MAX_CONTENT_BYTES } = require('./githubClient');
const AppError = require('./AppError');

const MAX_AFFECTED_PATHS = 20;
const WORKSPACE_ID_PATTERN = /^repodoctor-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidRequest(message = 'A scanned repository and approved prescription are required.') {
    return new AppError('INVALID_WORKSPACE_REQUEST', 400, message);
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isSafeRelativePath(value) {
    return typeof value === 'string' && value.length > 0 && value === value.trim() &&
        !value.includes('\0') && !value.includes('..') && !value.includes('\\') &&
        !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !/^[a-zA-Z]:/.test(value) &&
        value.split('/').every((segment) => segment.length > 0 && segment !== '.');
}

function validateRequest(params) {
    if (!isRecord(params) || Object.keys(params).some((key) => !['scanResult', 'prescription'].includes(key))) {
        throw invalidRequest();
    }

    const { scanResult, prescription } = params;
    if (!isRecord(scanResult) || typeof scanResult.scanId !== 'string' || !scanResult.scanId.trim()) {
        throw invalidRequest('A completed scan result is required.');
    }
    const { owner, repo, defaultBranch } = scanResult;
    if (
        typeof owner !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) ||
        typeof repo !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) ||
        typeof defaultBranch !== 'string' || !defaultBranch.trim() || defaultBranch !== defaultBranch.trim() ||
        defaultBranch.length > 255 || /[\u0000-\u001f\u007f]/.test(defaultBranch)
    ) {
        throw invalidRequest('The scanned repository identity is incomplete or invalid.');
    }
    if (!isRecord(prescription) || prescription.approved !== true || !Array.isArray(prescription.affectedPaths)) {
        throw invalidRequest('An approved prescription with affected paths is required.');
    }
    if (prescription.affectedPaths.length === 0 || prescription.affectedPaths.length > MAX_AFFECTED_PATHS) {
        throw invalidRequest('The approved prescription must contain between 1 and 20 affected paths.');
    }
    if (!prescription.affectedPaths.every(isSafeRelativePath)) {
        throw new AppError('UNSAFE_PATH', 400, 'Approved file paths must be safe repository-relative paths.');
    }

    return {
        scanId: scanResult.scanId,
        owner,
        repo,
        defaultBranch,
        affectedPaths: [...new Set(prescription.affectedPaths)],
    };
}

async function resolveWorkspaceRoot() {
    const configuredRoot = process.env.TREATMENT_WORKSPACE_ROOT;
    const requestedRoot = configuredRoot && configuredRoot.trim()
        ? path.resolve(configuredRoot.trim())
        : path.join(os.tmpdir(), 'repodoctor-workspaces');

    try {
        await fs.mkdir(requestedRoot, { recursive: true, mode: 0o700 });
        const root = await fs.realpath(requestedRoot);
        if (!(await fs.stat(root)).isDirectory()) throw new Error('not a directory');
        return root;
    } catch {
        throw new AppError('WORKSPACE_ROOT_INVALID', 500, 'The configured workspace root is unavailable.');
    }
}

function validateWorkspaceId(workspaceId) {
    if (typeof workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
        throw new AppError('INVALID_WORKSPACE_ID', 400, 'The workspace identifier is invalid.');
    }
}

async function resolveWorkspaceDirectory(root, workspaceId) {
    validateWorkspaceId(workspaceId);
    const candidate = path.join(root, workspaceId);

    let resolved;
    try {
        resolved = await fs.realpath(candidate);
        if (!(await fs.stat(resolved)).isDirectory()) throw new Error('not a directory');
    } catch {
        throw new AppError('WORKSPACE_NOT_FOUND', 404, 'The workspace is unavailable.');
    }

    if (!isWithin(root, resolved) || path.dirname(resolved) !== root) {
        throw new AppError('UNSAFE_WORKSPACE_PATH', 400, 'The workspace is outside the permitted root.');
    }
    return resolved;
}

function resolveMaterializedPath(relativePath, workspacePath) {
    if (!isSafeRelativePath(relativePath)) {
        throw new AppError('UNSAFE_PATH', 400, 'A repository file path is not permitted.');
    }
    const absolutePath = path.resolve(workspacePath, ...relativePath.split('/'));
    if (!isWithin(workspacePath, absolutePath) || absolutePath === workspacePath) {
        throw new AppError('UNSAFE_PATH', 400, 'A repository file path is not permitted.');
    }
    return absolutePath;
}

async function readApprovedFiles(repository, affectedPaths) {
    let metadata;
    let treeResult;
    try {
        metadata = await getRepoInfo(repository.owner, repository.repo);
        if (
            !isRecord(metadata) || metadata.isPrivate !== false ||
            typeof metadata.owner !== 'string' || typeof metadata.repo !== 'string' ||
            metadata.owner.toLowerCase() !== repository.owner.toLowerCase() ||
            metadata.repo.toLowerCase() !== repository.repo.toLowerCase()
        ) {
            if (metadata?.isPrivate === true) {
                throw new AppError('REPO_PRIVATE', 403, 'Only public repositories can be prepared.');
            }
            throw new AppError('REPOSITORY_METADATA_INVALID', 502, 'GitHub returned incomplete repository metadata.');
        }

        treeResult = await getRepoTree(repository.owner, repository.repo, repository.defaultBranch);
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('GITHUB_UNAVAILABLE', 502, 'Repository files could not be retrieved from GitHub.');
    }

    if (!isRecord(treeResult) || !Array.isArray(treeResult.tree) || treeResult.truncated === true) {
        throw new AppError('REPOSITORY_TREE_UNAVAILABLE', 502, 'The repository file list is unavailable or incomplete.');
    }

    const blobs = new Set(treeResult.tree
        .filter((entry) => isRecord(entry) && entry.type === 'blob' && isSafeRelativePath(entry.path))
        .map((entry) => entry.path));
    for (const relativePath of affectedPaths) {
        if (!blobs.has(relativePath)) {
            throw new AppError('WORKSPACE_FILE_NOT_FOUND', 404, 'An approved repository file is unavailable.');
        }
    }

    const materializedFiles = [...new Set([
        ...(blobs.has('package.json') ? ['package.json'] : []),
        ...affectedPaths,
    ])];
    const fileContents = new Map();
    try {
        for (const relativePath of materializedFiles) {
            const file = await getFileContent(
                repository.owner,
                repository.repo,
                relativePath,
                repository.defaultBranch
            );
            if (
                !isRecord(file) || file.path !== relativePath || typeof file.content !== 'string' ||
                Buffer.byteLength(file.content, 'utf8') > MAX_CONTENT_BYTES ||
                (typeof file.size === 'number' && file.size > MAX_CONTENT_BYTES)
            ) {
                throw new AppError('WORKSPACE_FILE_UNAVAILABLE', 422, 'A required repository file could not be materialized.');
            }
            fileContents.set(relativePath, file.content);
        }
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('GITHUB_UNAVAILABLE', 502, 'Repository files could not be retrieved from GitHub.');
    }

    return { metadata, materializedFiles, fileContents };
}

async function removeCreatedWorkspace(root, workspacePath) {
    try {
        const resolved = await fs.realpath(workspacePath);
        if (isWithin(root, resolved) && path.dirname(resolved) === root) {
            await fs.rm(resolved, { recursive: true, force: true });
        }
    } catch {
        // Preserve the original preparation error and never broaden cleanup.
    }
}

async function createWorkspace(params) {
    const repository = validateRequest(params);
    const { metadata, materializedFiles, fileContents } = await readApprovedFiles(repository, repository.affectedPaths);
    const root = await resolveWorkspaceRoot();
    const workspaceId = `repodoctor-${crypto.randomUUID()}`;
    const workspacePath = path.join(root, workspaceId);

    try {
        await fs.mkdir(workspacePath, { mode: 0o700 });
        const resolvedWorkspace = await fs.realpath(workspacePath);
        if (!isWithin(root, resolvedWorkspace) || path.dirname(resolvedWorkspace) !== root) {
            throw new AppError('UNSAFE_WORKSPACE_PATH', 400, 'The generated workspace is outside the permitted root.');
        }

        for (const relativePath of materializedFiles) {
            const absolutePath = resolveMaterializedPath(relativePath, resolvedWorkspace);
            await fs.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
            await fs.writeFile(absolutePath, fileContents.get(relativePath), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        }

        return {
            workspaceId,
            repository: {
                owner: metadata.owner,
                repo: metadata.repo,
                defaultBranch: repository.defaultBranch,
            },
            materializedFiles,
        };
    } catch (error) {
        await removeCreatedWorkspace(root, workspacePath);
        if (error instanceof AppError) throw error;
        throw new AppError('WORKSPACE_PREPARATION_FAILED', 500, 'The temporary workspace could not be prepared.');
    }
}

async function runInWorkspace(workspaceId, operation) {
    if (typeof operation !== 'function') {
        throw new AppError('INVALID_WORKSPACE_OPERATION', 400, 'A backend workspace operation is required.');
    }
    const root = await resolveWorkspaceRoot();
    const workspacePath = await resolveWorkspaceDirectory(root, workspaceId);
    return operation(workspacePath);
}

async function cleanupWorkspace(workspaceId) {
    const root = await resolveWorkspaceRoot();
    const workspacePath = await resolveWorkspaceDirectory(root, workspaceId);
    try {
        await fs.rm(workspacePath, { recursive: true, force: true });
    } catch {
        throw new AppError('WORKSPACE_CLEANUP_FAILED', 500, 'The temporary workspace could not be removed.');
    }
    return { workspaceId, removed: true };
}

module.exports = { createWorkspace, runInWorkspace, cleanupWorkspace };