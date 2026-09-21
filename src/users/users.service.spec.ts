import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOneBy: jest.Mock;
    softDelete: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn((dto) => ({ ...dto, id: 7 })),
      save: jest.fn(async (entity) => entity),
      find: jest.fn(),
      findOneBy: jest.fn(),
      softDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('saves an entity instance so field exclusions stay enforced', async () => {
    await service.create({
      name: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'hashed',
      client: 'web',
    });

    expect(repository.create).toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com' }),
    );
  });

  it('only lists users that belong to the requesting client', async () => {
    await service.findAll('web', 2, 25);

    expect(repository.find).toHaveBeenCalledWith({
      where: { client: 'web' },
      skip: 25,
      take: 25,
    });
  });

  it('scopes a single user lookup to the client when one is given', async () => {
    await service.findOne(7, 'web');

    expect(repository.findOneBy).toHaveBeenCalledWith({ id: 7, client: 'web' });
  });

  it('looks up a user by id alone for internal flows like token refresh', async () => {
    await service.findOne(7);

    expect(repository.findOneBy).toHaveBeenCalledWith({ id: 7 });
  });

  it('soft deletes instead of removing the row', async () => {
    await service.remove(7);

    expect(repository.softDelete).toHaveBeenCalledWith({ id: 7 });
  });
});
