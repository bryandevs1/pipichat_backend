// socket.js
let io = null;

const setIO = (ioInstance) => {
  io = ioInstance;
};

const getIO = () => io;

module.exports = { setIO, getIO };
