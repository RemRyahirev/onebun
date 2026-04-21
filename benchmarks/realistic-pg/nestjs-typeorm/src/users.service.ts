import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './entities';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async findById(id: number) {
    const user = await this.userRepo.findOneBy({ id });
    return user ?? null;
  }

  async create(data: { name: string; email: string }) {
    const user = this.userRepo.create({
      name: data.name,
      email: data.email,
      createdAt: new Date().toISOString(),
    });
    return this.userRepo.save(user);
  }
}
