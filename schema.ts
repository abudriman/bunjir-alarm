import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const contacts = sqliteTable("contacts", {
    jid: text("jid").primaryKey(),
    name: text("name").notNull(),
});
