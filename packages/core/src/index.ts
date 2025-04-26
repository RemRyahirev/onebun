export * from './metadata';
export * from './application';
export * from './module';
export { Controller as BaseController } from './controller';
export { Service, BaseService, getServiceTag } from './service';
// Экспортируем декораторы явно, чтобы избежать конфликтов
export {
  ControllerDecorator,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Options,
  Head,
  All,
  Module,
  getControllerMetadata,
  // Parameter decorators
  Param,
  Query,
  Body,
  Header,
  Req,
  Res,
  // Middleware decorator
  UseMiddleware
} from './decorators';
export * from './types';
