import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity()
@Index(['client', 'email'])
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  lastName: string;

  @Column({
    unique: true,
    nullable: false,
  })
  email: string;

  @Column({ nullable: true })
  @Exclude()
  password: string | null;

  @Column({ default: 'local' })
  provider: string;

  @Column()
  client: string;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @Column({ nullable: true, type: 'timestamp' })
  emailVerifiedAt: Date | null;
}
