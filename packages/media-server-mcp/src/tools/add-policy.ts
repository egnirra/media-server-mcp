/** Optional operator policy for add tools. No policy means caller-chosen inputs. */
export interface AddPolicy {
  qualityProfileId: number | undefined;
  rootFolderPath: string | undefined;
  searchOnAdd: boolean | undefined;
  monitor: "all" | "future" | "none" | undefined;
}

export function getAddPolicy(service: "SONARR" | "RADARR"): AddPolicy {
  const profile = Deno.env.get(`${service}_ADD_QUALITY_PROFILE_ID`);
  const qualityProfileId = profile === undefined ? undefined : Number(profile);
  if (
    qualityProfileId !== undefined &&
    (!Number.isSafeInteger(qualityProfileId) || qualityProfileId <= 0)
  ) {
    throw new Error(
      `${service}_ADD_QUALITY_PROFILE_ID must be a positive integer`,
    );
  }
  const rootFolderPath = Deno.env.get(`${service}_ADD_ROOT_FOLDER`);
  if (rootFolderPath !== undefined && !rootFolderPath.startsWith("/")) {
    throw new Error(`${service}_ADD_ROOT_FOLDER must be an absolute path`);
  }
  const search = Deno.env.get(`${service}_SEARCH_ON_ADD`);
  if (search !== undefined && search !== "true" && search !== "false") {
    throw new Error(`${service}_SEARCH_ON_ADD must be true or false`);
  }
  const monitor = service === "SONARR"
    ? Deno.env.get("SONARR_ADD_MONITOR")
    : undefined;
  if (
    monitor !== undefined && monitor !== "all" && monitor !== "future" &&
    monitor !== "none"
  ) {
    throw new Error("SONARR_ADD_MONITOR must be all, future, or none");
  }
  return {
    qualityProfileId,
    rootFolderPath,
    searchOnAdd: search === undefined ? undefined : search === "true",
    monitor,
  };
}

export function enforceAddPolicy(
  policy: AddPolicy,
  input: {
    qualityProfileId: number;
    rootFolderPath: string;
    searchOnAdd: boolean;
    monitor?: string;
    monitored?: boolean;
    monitorNewItems?: string;
    seasons?: Array<{ seasonNumber: number; monitored: boolean }> | undefined;
  },
): void {
  for (
    const key of ["qualityProfileId", "rootFolderPath", "searchOnAdd"] as const
  ) {
    if (policy[key] !== undefined && policy[key] !== input[key]) {
      throw new Error(`Add operation violates operator policy for ${key}`);
    }
  }
  if (policy.monitor !== undefined && policy.monitor !== input.monitor) {
    throw new Error("Add operation violates operator policy for monitor");
  }
  if (
    policy.monitor === "future" &&
    (input.monitored === false || input.monitorNewItems !== "all" ||
      (input.seasons?.length ?? 0) > 0)
  ) {
    throw new Error(
      "Future-only add policy requires monitoring new items and no season overrides",
    );
  }
}
