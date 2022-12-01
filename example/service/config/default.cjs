module.exports = {
  host: 'localhost',
  port: process.env.PORT || 3031,
  public: 'public',
  paginate: {
    default: 10,
    max: 50
  },
  nedb: '../data'
}
