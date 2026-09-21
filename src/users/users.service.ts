import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  create(createUserDto: CreateUserDto) {
    return this.userRepository.save(this.userRepository.create(createUserDto));
  }

  findOneByEmail(email: string) {
    return this.userRepository.findOneBy({ email });
  }

  findAll(client: string, page = 1, limit = 10) {
    return this.userRepository.find({
      where: { client },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  findOne(id: number, client?: string) {
    if (client === undefined) {
      return this.userRepository.findOneBy({ id });
    }
    return this.userRepository.findOneBy({ id, client });
  }

  remove(id: number) {
    return this.userRepository.softDelete({ id });
  }
}
