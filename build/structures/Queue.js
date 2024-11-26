class Queue {
    constructor() {
        this.items = [];
    }

    get size() {
        return this.items.length;
    }

    get first() {
        return this.items.length ? this.items[0] : null;
    }

    add(track) {
        this.items.push(track);
        return this;
    }

    remove(index) {
        if (index >= 0 && index < this.items.length) {
            return this.items.splice(index, 1)[0];
        } else {
            throw new Error("Index out of range");
        }
    }

    clear() {
        this.items.length = 0;
    }

    shuffle() {
        for (let i = this.items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
        }
    }
}

module.exports = { Queue };
