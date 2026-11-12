import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
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

  findOneByEmailWithDeleted(email: string) {
    return this.userRepository.findOne({ where: { email }, withDeleted: true });
  }

  findAll(client: string, page = 1, limit = 10) {
    return this.userRepository.find({
      where: { client },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  count(client: string) {
    return this.userRepository.count({ where: { client } });
  }

  findOne(id: number, client?: string) {
    if (client === undefined) {
      return this.userRepository.findOneBy({ id });
    }
    return this.userRepository.findOneBy({ id, client });
  }

  findOneWithDeleted(id: number) {
    return this.userRepository.findOne({ where: { id }, withDeleted: true });
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return this.userRepository.update({ id }, updateUserDto);
  }

  restore(id: number) {
    return this.userRepository.restore({ id });
  }

  remove(id: number) {
    return this.userRepository.softDelete({ id });
  }
}
