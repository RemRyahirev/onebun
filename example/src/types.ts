// Типизированные интерфейсы для данных
export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  address: {
    street: string;
    suite: string;
    city: string;
    zipcode: string;
    geo: {
      lat: string;
      lng: string;
    };
  };
  phone: string;
  website: string;
  company: {
    name: string;
    catchPhrase: string;
    bs: string;
  };
}

export interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

// Типизированные интерфейсы для запросов
export interface UserQuery {
  name?: string;
  email?: string;
  website?: string;
}

export interface PostQuery {
  userId?: string;
  title?: string;
}

export interface CreatePostData {
  title: string;
  body: string;
  userId: number;
}

export interface UpdateUserData {
  name?: string;
  email?: string;
  phone?: string;
}
