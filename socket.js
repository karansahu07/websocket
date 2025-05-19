exports = module.exports = (io) => {
    io.on('connection', (socket) => {

        // Register user (for 1:1 messaging)
        socket.on("register-user", (userId) => {
            socket.join(`user_${userId}`);
            console.log("user joined", userId);
        });

        // Join a group chat room
        socket.on("open-group", (groupId) => {
            socket.join(groupId);
        });

        // Handle incoming messages
        socket.on("messageFromUser", (data) => {
            console.log(data);
            // data should include: type, message, sender_id, group_id OR receiver_id

            if (data.type === "group") {
                // Broadcast to everyone in the group except sender
                socket.to(data.group_id).emit("messageFromServer", data);

            } else if (data.type === "private") {
                // Send to recipient
                io.to(`user_${data.receiver_id}`).emit("privateMessageFromServer", data);
                // Optional: also emit back to sender for sync
                io.to(`user_${data.sender_id}`).emit("privateMessageFromServer", data);
            }
        });

        // Optional: notify when someone disconnects
        socket.on('disconnect', () => {
            // Handle disconnect logic if needed
        });
    });
};