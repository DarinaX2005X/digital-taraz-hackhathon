import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { decodeDirectUploadTarget, deploymentArguments, deploymentOrigin, deploymentSourceBytes } from '../../scripts/release/verify-deployment.mjs';

const r2Token = (url) => `r2.v1.${Buffer.from(JSON.stringify({ url })).toString('base64url')}`;

describe('deployed API smoke safety boundary', () => {
  it('accepts one canonical HTTPS origin and rejects credentials, paths, queries and HTTP', () => {
    assert.equal(deploymentOrigin('https://tirlik.vercel.app'), 'https://tirlik.vercel.app');
    for (const origin of ['http://tirlik.vercel.app', 'https://user:pass@tirlik.vercel.app', 'https://tirlik.vercel.app/path', 'https://tirlik.vercel.app/?token=private']) {
      assert.throws(() => deploymentOrigin(origin), /DEPLOYMENT_ORIGIN_INVALID/, origin);
    }
  });

  it('only decodes signed Cloudflare R2 upload targets', () => {
    const target = `https://${'a'.repeat(32)}.r2.cloudflarestorage.com/tirlik-files/proof?X-Amz-Signature=${'b'.repeat(64)}`;
    assert.equal(decodeDirectUploadTarget(r2Token(target)), target);
    assert.throws(() => decodeDirectUploadTarget(r2Token('https://example.com/proof?X-Amz-Signature=fake')), /DEPLOYMENT_R2_TOKEN_INVALID/);
    assert.throws(() => decodeDirectUploadTarget('local-token'), /DEPLOYMENT_R2_TOKEN_MISSING/);
  });

  it('builds an exact deterministic large source with recognizable boundaries', () => {
    const first = deploymentSourceBytes(), second = deploymentSourceBytes();
    assert.equal(first.length, 6_350_000);
    assert(first.equals(second));
    assert.match(first.subarray(0, 35).toString('utf8'), /Tirlik deployment persistence/);
    assert.match(first.subarray(-50).toString('utf8'), /END Tirlik deployment persistence/);
  });

  it('keeps missing-model authorization on prepare and state-based phases separate', () => {
    const prepare = deploymentArguments(['prepare', '--origin', 'https://tirlik.vercel.app', '--expect-missing-model']);
    assert.deepEqual({ action: prepare.action, origin: prepare.origin, expectMissingModel: prepare.expectMissingModel, stateName: path.basename(prepare.statePath) }, { action: 'prepare', origin: 'https://tirlik.vercel.app', expectMissingModel: true, stateName: 'deployment-smoke.json' });
    const verify = deploymentArguments(['verify', '--state', '.local-data/release/proof.json']);
    assert.deepEqual({ action: verify.action, origin: verify.origin, expectMissingModel: verify.expectMissingModel, stateName: path.basename(verify.statePath) }, { action: 'verify', origin: undefined, expectMissingModel: false, stateName: 'proof.json' });
    assert.throws(() => deploymentArguments(['verify', '--expect-missing-model']), /DEPLOYMENT_OPTION_INVALID/);
    assert.throws(() => deploymentArguments(['prepare', '--origin', 'https://tirlik.vercel.app', '--origin', 'https://other.example']), /DEPLOYMENT_OPTION_DUPLICATE/);
  });
});
