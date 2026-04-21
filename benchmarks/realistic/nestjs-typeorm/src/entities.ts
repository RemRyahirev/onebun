import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ name: 'created_at' })
  createdAt!: string;

  @OneToMany(() => Post, (post) => post.author)
  posts!: Post[];
}

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column()
  body!: string;

  @Column({ name: 'author_id' })
  authorId!: number;

  @Column({ default: true })
  published!: boolean;

  @Column({ name: 'created_at' })
  createdAt!: string;

  @ManyToOne(() => User, (user) => user.posts)
  @JoinColumn({ name: 'author_id' })
  author!: User;

  @OneToMany(() => Comment, (comment) => comment.post)
  comments!: Comment[];
}

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  body!: string;

  @Column({ name: 'post_id' })
  postId!: number;

  @Column({ name: 'author_id' })
  authorId!: number;

  @Column({ name: 'created_at' })
  createdAt!: string;

  @ManyToOne(() => Post, (post) => post.comments)
  @JoinColumn({ name: 'post_id' })
  post!: Post;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'author_id' })
  author!: User;
}
