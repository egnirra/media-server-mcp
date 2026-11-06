import { assertEquals, assertThrows } from "@std/assert";
import { stub } from "@std/testing/mock";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { createSonarrConfig } from "@wyattjoh/sonarr";
import { createRadarrConfig } from "@wyattjoh/radarr";
import { getAddPolicy } from "../../src/tools/add-policy.ts";
import { createSonarrTools } from "../../src/tools/sonarr-tools.ts";
import { createRadarrTools } from "../../src/tools/radarr-tools.ts";

function withEnv(values: Record<string, string>, run: () => Promise<void>) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });
}

for (const service of ["SONARR", "RADARR"] as const) {
  Deno.test(`${service} add policy defaults reach POST; overrides never write`, () =>
    withEnv({
      [`${service}_ADD_QUALITY_PROFILE_ID`]: "4",
      [`${service}_ADD_ROOT_FOLDER`]: "/media/library",
      [`${service}_SEARCH_ON_ADD`]: "false",
      SONARR_ADD_MONITOR: "future",
    }, async () => {
      const requests: Array<Record<string, unknown>> = [];
      const fetchStub = stub(globalThis, "fetch", (_url, init) => {
        assertEquals(init?.method, "POST");
        const payload = JSON.parse(String(init?.body));
        requests.push(payload);
        return Promise.resolve(
          new Response(JSON.stringify({ ...payload, id: 123 }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      });
      const server = new McpServer({ name: "policy-test", version: "1" });
      const tv = service === "SONARR";
      const name = tv ? "sonarr_add_series" : "radarr_add_movie";
      const base = tv ? { tvdbId: 123, title: "Test" } : {
        tmdbId: 123,
        title: "Test",
        year: 2026,
        minimumAvailability: "released",
      };
      let client: Client | undefined;
      try {
        if (tv) {
          createSonarrTools(
            server,
            createSonarrConfig("http://localhost:8989", "test"),
            (tool) => tool === name,
          );
        } else {createRadarrTools(
            server,
            createRadarrConfig("http://localhost:7878", "test"),
            (tool) => tool === name,
          );}
        const [ct, st] = InMemoryTransport.createLinkedPair();
        await server.connect(st);
        client = new Client({ name: "test", version: "1" });
        await client.connect(ct);
        const result = await client.callTool({ name, arguments: base });
        assertEquals(result.isError, undefined, JSON.stringify(result));
        assertEquals(requests.length, 1);
        assertEquals(requests[0].qualityProfileId, 4);
        assertEquals(requests[0].rootFolderPath, "/media/library");
        const options = requests[0].addOptions as Record<string, unknown>;
        assertEquals(
          options[tv ? "searchForMissingEpisodes" : "searchForMovie"],
          false,
        );
        if (tv) {
          assertEquals(options.monitor, "future");
          assertEquals(options.searchForCutoffUnmetEpisodes, false);
          assertEquals(requests[0].monitorNewItems, "all");
          assertEquals(requests[0].monitored, true);
          assertEquals(requests[0].seasons, []);
        }
        const overrides = [
          { qualityProfileId: 1 },
          { rootFolderPath: "/elsewhere" },
          { [tv ? "searchForMissingEpisodes" : "searchForMovie"]: true },
          ...(tv
            ? [
              { monitor: "all" },
              { monitor: "none" },
              { monitored: false },
              { monitorNewItems: "none" },
              { seasons: [{ seasonNumber: 1, monitored: true }] },
            ]
            : []),
        ];
        for (const override of overrides) {
          const rejected = await client.callTool({
            name,
            arguments: { ...base, ...override },
          });
          assertEquals(rejected.isError, true, JSON.stringify(override));
          assertEquals(requests.length, 1);
        }
      } finally {
        await client?.close();
        fetchStub.restore();
      }
    }));
}

Deno.test("invalid operator settings fail closed", () =>
  withEnv(
    { SONARR_ADD_QUALITY_PROFILE_ID: "0", RADARR_SEARCH_ON_ADD: "yes" },
    () => {
      assertThrows(() => getAddPolicy("SONARR"), Error, "positive integer");
      assertThrows(() => getAddPolicy("RADARR"), Error, "true or false");
      return Promise.resolve();
    },
  ));
