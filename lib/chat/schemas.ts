import { z } from "zod";

/**
 * chatQuestionSchema — validates the POST /api/tenants/[id]/chat request body.
 *
 * Constraints (CHAT-02):
 *   - `question` is required (min 1 char — prevents empty spawns)
 *   - max 500 chars — prevents absurdly long CLI args that could hang gbrain
 */
export const chatQuestionSchema = z.object({
  question: z.string().min(1, "Question cannot be empty").max(500, "Question exceeds 500 characters"),
});

export type ChatQuestion = z.infer<typeof chatQuestionSchema>;
