import { describe, it, expect } from "vitest";
import { buildSpanningTree } from "./hierarchy";
import type { AppMapNode, AppMapEdge, AppMapEdgeKind } from "./build-map";

function node(id: string): AppMapNode {
  return {
    id,
    url: `https://a.test${id}`,
    path: id,
    title: null,
    sources: ["crawl"],
    area: null,
    functionalAreaId: null,
    routeId: null,
    hasTest: false,
    coverageStatus: "uncovered",
    isExtraPath: false,
    apiEndpoints: [],
  };
}

function edge(
  source: string,
  target: string,
  kind: AppMapEdgeKind = "link",
): AppMapEdge {
  return { id: `${source}->${target}:${kind}`, source, target, kind };
}

describe("buildSpanningTree", () => {
  it("returns null when the root is not in the graph", () => {
    expect(buildSpanningTree([node("/")], [], "/missing")).toBeNull();
  });

  it("builds a BFS tree with depths and tree edges", () => {
    const nodes = [node("/"), node("/a"), node("/b"), node("/a/x")];
    const edges = [
      edge("/", "/a"),
      edge("/", "/b"),
      edge("/a", "/a/x"),
      edge("/b", "/a"), // non-tree: /a already discovered at depth 1
    ];
    const tree = buildSpanningTree(nodes, edges, "/")!;
    expect(tree.parent.get("/a")).toBe("/");
    expect(tree.parent.get("/b")).toBe("/");
    expect(tree.parent.get("/a/x")).toBe("/a");
    expect(tree.depth.get("/a/x")).toBe(2);
    expect(tree.treeEdgeIds).toEqual(
      new Set(["/->/a:link", "/->/b:link", "/a->/a/x:link"]),
    );
    expect(tree.unreachable).toEqual([]);
  });

  it("prefers nav over redirect over link when a node is discovered at the same depth", () => {
    const nodes = [node("/"), node("/a"), node("/b"), node("/t")];
    const edges = [
      edge("/", "/a"),
      edge("/", "/b"),
      edge("/a", "/t", "link"),
      edge("/b", "/t", "nav"),
    ];
    const tree = buildSpanningTree(nodes, edges, "/")!;
    expect(tree.parent.get("/t")).toBe("/b");
    expect(tree.treeEdgeIds.has("/b->/t:nav")).toBe(true);
    expect(tree.treeEdgeIds.has("/a->/t:link")).toBe(false);
  });

  it("shorter hop distance wins over edge kind (BFS, not best-kind-first)", () => {
    const nodes = [node("/"), node("/a"), node("/t")];
    const edges = [
      edge("/", "/t", "link"), // depth 1 via link
      edge("/", "/a", "nav"),
      edge("/a", "/t", "nav"), // depth 2 via nav — too late
    ];
    const tree = buildSpanningTree(nodes, edges, "/")!;
    expect(tree.parent.get("/t")).toBe("/");
    expect(tree.depth.get("/t")).toBe(1);
  });

  it("parks nodes unreachable from the root", () => {
    const nodes = [node("/"), node("/a"), node("/island"), node("/island/2")];
    const edges = [edge("/", "/a"), edge("/island", "/island/2")];
    const tree = buildSpanningTree(nodes, edges, "/")!;
    expect(tree.unreachable).toEqual(["/island", "/island/2"]);
    expect(tree.parent.has("/island")).toBe(false);
  });

  it("orders children by path for a stable outline", () => {
    const nodes = [node("/"), node("/z"), node("/a"), node("/m")];
    const edges = [edge("/", "/z"), edge("/", "/a"), edge("/", "/m")];
    const tree = buildSpanningTree(nodes, edges, "/")!;
    expect(tree.children.get("/")).toEqual(["/a", "/m", "/z"]);
  });

  it("ignores edges pointing at unknown nodes", () => {
    const nodes = [node("/"), node("/a")];
    const edges = [edge("/", "/a"), edge("/", "/ghost"), edge("/ghost", "/a")];
    const tree = buildSpanningTree(nodes, edges, "/")!;
    expect(tree.parent.get("/a")).toBe("/");
    expect([...tree.parent.keys()].sort()).toEqual(["/", "/a"]);
  });
});
