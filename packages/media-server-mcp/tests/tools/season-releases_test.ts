import { assertEquals, assertExists } from "@std/assert";
import { stub } from "@std/testing/mock";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { createSonarrConfig } from "@wyattjoh/sonarr";
import { createSonarrTools } from "../../src/tools/sonarr-tools.ts";

Deno.test("season release browsing uses GET, preserves pack metadata, and rejects invalid scope before networking", async () => {
  const releases = [
    {
      guid: "pack-guid",
      indexerId: 2,
      title: "Show.S01.1080p.x265",
      fullSeason: true,
      size: 123456789,
      seeders: 17,
      approved: false,
      rejections: ["codec restriction"],
      customFormats: [{ name: "HEVC" }],
    },
    {
      guid: "episode-guid",
      indexerId: 2,
      title: "Show.S01E02.1080p",
      fullSeason: false,
      episodeNumbers: [2],
      size: 1234,
    },
  ];
  let calls = 0;
  const fetchStub = stub(globalThis, "fetch", (url, init) => {
    calls++;
    assertEquals(
      String(url),
      `http://localhost:8989/api/v3/release?seriesId=266&seasonNumber=${
        calls === 1 ? 1 : 0
      }`,
    );
    assertEquals(init?.method ?? "GET", "GET");
    assertEquals(init?.body, undefined);
    return Promise.resolve(
      new Response(JSON.stringify(releases), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const server = new McpServer({ name: "test", version: "1" });
  let client: Client | undefined;
  try {
    createSonarrTools(
      server,
      createSonarrConfig("http://localhost:8989", "fake"),
      (name) => name === "sonarr_get_season_releases",
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "test", version: "1" });
    await client.connect(ct);
    const tools = await client.listTools();
    assertEquals(tools.tools.length, 1);
    assertEquals(tools.tools[0].annotations?.readOnlyHint, true);
    assertExists(tools.tools[0].inputSchema);
    for (const seasonNumber of [1, 0]) {
      const result = await client.callTool({
        name: "sonarr_get_season_releases",
        arguments: { seriesId: 266, seasonNumber },
      });
      assertEquals(result.isError, undefined);
      assertEquals(result.structuredContent, { data: releases });
    }
    for (
      const args of [
        { seriesId: 266 },
        { seasonNumber: 1 },
        { seriesId: 0, seasonNumber: 1 },
        { seriesId: 266, seasonNumber: -1 },
        { seriesId: 1.5, seasonNumber: 1 },
        { seriesId: 266, seasonNumber: 1, search: true },
      ]
    ) {
      const result = await client.callTool({
        name: "sonarr_get_season_releases",
        arguments: args,
      });
      assertEquals(result.isError, true);
      assertEquals(calls, 2);
    }
  } finally {
    await client?.close();
    fetchStub.restore();
  }
});
