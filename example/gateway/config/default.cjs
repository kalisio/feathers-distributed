module.exports = {
  host: 'localhost',
  port: process.env.PORT || 3030,
  public: 'public',
  paginate: {
    default: 10,
    max: 50
  },
  authentication: {
    secret: 'a3d7c5b2f8c9a0e97c2324176f208b49f2fb51696b3b30fb13074063bfa0bcf3aa943fe60c8e2c9a8e07a5988b0fbf196b61d066ede25657b5fa24285f38297be0a90af35f6bfebee7e302733e73d91375f9f7397275216c9d10ec43aef0f719b32f8c8cfad62d755a2d97e698f229d02fb6ac922ec35c89bee636b699c01d41b1e6039001c0b0d1849b34bbabbab424abff17beecb45c2ef43a0947ac40384bb86db9361e56acf2111f1dc6aa1aacdfd6415f41cac86f59bc6301104b93f4dc1fd99f38fab2950e6cddafa9b97ad5ca1b091ad188c9ee70570dde3f1eef32cfb67a5b7b5f27f9f0c359361bb299f06bb18a6205c3f4a8c5949058289dd3bb92',
    authStrategies: [
      'jwt',
      'local'
    ],
    path: '/authentication',
    service: 'users',
    entity: 'user',
    local: {
      usernameField: 'email',
      passwordField: 'password' 
    },
    jwtOptions: {
      header: {
        type: 'access' 
      },
      audience: 'https://yourdomain.com',
      issuer: 'feathers',
      algorithm: 'HS256',
      expiresIn: '1d' 
    }
  },
  nedb: '../data'
}
