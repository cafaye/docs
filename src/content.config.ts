// src/content.config.ts — Starlight's content collections.
//
// docsLoader() reads Markdown/MDX from src/content/docs/ and ignores files whose
// name starts with `_`. docsSchema() is what validates frontmatter: `title` and
// `description` are the required fields, so a page missing either fails the
// build instead of shipping an untitled page or an empty meta description.
//
// No custom fields are extended. When one is added, extend it here in the same
// commit as the first page that uses it — a schema that drifts from its content
// is how a field starts being optional in practice and only optional on paper.
import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema(),
  }),
  // Starlight queries the i18n collection on every build even for an
  // English-only site, and warns when it is undefined. Declaring it empty (see
  // src/content/i18n/en.json) keeps the build output clean. Add a language only
  // with a decision to maintain it in step with the English pages — a half
  // translated docs site is worse than an English-only one.
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema(),
  }),
};