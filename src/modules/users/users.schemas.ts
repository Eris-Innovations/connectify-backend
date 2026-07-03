import { z } from 'zod';

export const updateMeSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_.]+$/).optional(),
    bio: z.string().max(300).optional(),
    avatar: z.string().max(2048).optional(),
    hasCompletedProfile: z.boolean().optional(),
    settings: z
      .object({
        privacy: z.enum(['public', 'private']).optional(),
        notificationsEnabled: z.boolean().optional(),
        messageNotificationsEnabled: z.boolean().optional(),
        callNotificationsEnabled: z.boolean().optional(),
        readReceiptsEnabled: z.boolean().optional(),
        showLastSeen: z.boolean().optional(),
        theme: z.enum(['system', 'light', 'dark']).optional()
      })
      .optional()
  })
});
