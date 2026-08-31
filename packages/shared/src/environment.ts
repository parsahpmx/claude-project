/**
 * Environments.
 *
 * Two orthogonal axes, deliberately kept distinct because conflating them is a
 * classic source of "the staging deploy moved real money" incidents:
 *
 *  - `DeployEnvironment` is where Meter402's own infrastructure is running.
 *  - `MerchantEnvironment` is the merchant-facing TEST/LIVE mode that decides
 *    whether a payment touches a real chain.
 *
 * A staging deployment still has both TEST and LIVE merchant modes; a LIVE
 * merchant project in staging is a real payment. The two must never be
 * inferred from one another.
 */

export enum DeployEnvironment {
  Local = 'local',
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
}

export enum MerchantEnvironment {
  Test = 'TEST',
  Live = 'LIVE',
}

export function isProductionDeploy(env: DeployEnvironment): boolean {
  return env === DeployEnvironment.Production;
}

/** API key prefixes. The environment of a key is legible from the key itself. */
export const API_KEY_PREFIX: Record<MerchantEnvironment, string> = {
  [MerchantEnvironment.Test]: 'meter_test',
  [MerchantEnvironment.Live]: 'meter_live',
};

export function environmentFromApiKeyPrefix(prefix: string): MerchantEnvironment | undefined {
  if (prefix === API_KEY_PREFIX[MerchantEnvironment.Test]) return MerchantEnvironment.Test;
  if (prefix === API_KEY_PREFIX[MerchantEnvironment.Live]) return MerchantEnvironment.Live;
  return undefined;
}

export function parseDeployEnvironment(value: string | undefined): DeployEnvironment {
  switch (value) {
    case 'local':
      return DeployEnvironment.Local;
    case 'development':
      return DeployEnvironment.Development;
    case 'staging':
      return DeployEnvironment.Staging;
    case 'production':
      return DeployEnvironment.Production;
    default:
      // Fail closed: an unrecognised value must not silently become
      // "production" (over-permissive secrets checks) or "local"
      // (under-permissive). Callers decide how to surface this.
      throw new Error(
        `Unknown DEPLOY_ENV ${JSON.stringify(value)}. ` +
          `Expected one of: local, development, staging, production.`,
      );
  }
}
