// Deliberately broken fixture: force-unwrap → null reference risk.
import React from 'react';

interface UserResponse {
  name?: string;
}

export function UserGreeting(props: { user: UserResponse }) {
  // BUG: `props.user.name!` will throw at runtime when name is undefined.
  const greeting = `Hello, ${props.user.name!.toUpperCase()}`;
  return <div>{greeting}</div>;
}
