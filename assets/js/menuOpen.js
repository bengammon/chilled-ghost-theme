// Toggle the menu open and close when on mobile
export default function menuOpen() {
    const burgerButton = document.querySelector('.gh-burger');

    if (!burgerButton) return;

    function setOpen(isOpen) {
        document.body.classList.toggle('gh-head-open', isOpen);
        burgerButton.setAttribute('aria-expanded', String(isOpen));
    }

    burgerButton.addEventListener('click', function () {
        setOpen(!document.body.classList.contains('gh-head-open'));
    });

    // Escape closes the menu and returns focus to the button that opened it
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && document.body.classList.contains('gh-head-open')) {
            setOpen(false);
            burgerButton.focus();
        }
    });
}
