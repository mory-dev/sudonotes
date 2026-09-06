import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum([
      "start",
      "write",
      "find",
      "projects",
      "data",
      "reference",
    ]),
    order: z.number().int().positive(),
    status: z.enum(["shipped", "planned"]).default("shipped"),
    appliesTo: z.enum(["desktop", "all", "planned-web"]).default("desktop"),
    lastReviewed: z.string(),
    sources: z.array(z.string()).min(1),
    related: z.array(z.string()).default([]),
    searchTerms: z.array(z.string()).default([]),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string(),
    author: z.string(),
    updated: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    canonical: z.string().optional(),
  }),
});

export const collections = { docs, blog };
