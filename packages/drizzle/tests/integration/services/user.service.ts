/**
 * User service for integration tests - business logic layer
 */
import type { UserRepository } from '../repositories/user.repository';
import type { User, InsertUser } from '../schema/users';

/**
 * User service - business logic layer
 */
export class UserService {
  constructor(private userRepository: UserRepository) {}

  async getAllUsers(): Promise<User[]> {
    return await this.userRepository.findAll();
  }

  async getUserById(id: number): Promise<User | null> {
    return await this.userRepository.findById(id);
  }

  async createUser(data: { name: string; email: string; age?: number }): Promise<User> {
    return await this.userRepository.create(data);
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User | null> {
    return await this.userRepository.update(id, data);
  }

  async deleteUser(id: number): Promise<boolean> {
    return await this.userRepository.delete(id);
  }

  async getUserCount(): Promise<number> {
    return await this.userRepository.count();
  }
}
