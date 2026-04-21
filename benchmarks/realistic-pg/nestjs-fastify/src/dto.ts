import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export class CreateUserDto extends createZodDto(createUserSchema) {}

const createPostSchema = z.object({
  title: z.string().min(3),
  body: z.string().min(10),
  authorId: z.number().positive(),
});

export class CreatePostDto extends createZodDto(createPostSchema) {}
