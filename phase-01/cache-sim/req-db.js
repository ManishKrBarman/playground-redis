export function getUserFromDB(id) {
    return new Promise((resolve) => {
        setTimeout(() => {
            console.log("Fetching from DB...");
            resolve({ id, name: "Manish", age: 21 });
        }, 2000); // simulate delay
    });
}