import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  hello() {
    return { success: true, result: { message: 'Hello, World!' } };
  }
}
