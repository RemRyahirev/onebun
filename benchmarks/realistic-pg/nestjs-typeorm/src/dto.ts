import { IsString, IsNumber, IsEmail, IsPositive, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;
}

export class CreatePostDto {
  @IsString()
  @MinLength(3)
  title!: string;

  @IsString()
  @MinLength(10)
  body!: string;

  @IsNumber()
  @IsPositive()
  authorId!: number;
}
