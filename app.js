document.addEventListener('DOMContentLoaded', () => {
    const gameItems = document.querySelectorAll('.game-item');
    
    gameItems.forEach(item => {
        item.addEventListener('click', () => {
            const game = item.dataset.game;
            window.location.href = `game.html?game=${game}`;
        });
    });
}); 