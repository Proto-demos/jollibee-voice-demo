const VIDEO_ID = "r9dXNjf37aA";

/** Intro section: the demo video, with a button that scrolls down to the live kiosk. */
export function VideoHero() {
  return (
    <section className="relative h-screen min-h-[600px] p-4">
      <div className="h-full rounded-[20px] bg-[#EFEFEF] px-4 pt-14 pb-[74px] sm:px-14 flex">
        {/* Sized against this box (container units) so the video keeps 16:9 at any viewport. */}
        <div className="video-fit flex-1 min-w-0 flex items-center justify-center">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0&modestbranding=1&playsinline=1`}
            title="Proto voice AI drive-thru demo video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            className="rounded-2xl bg-[#DADADA] border-0"
          />
        </div>
      </div>

      {/* Kept inside this section, pulse included, so none of it shows once the kiosk is scrolled to. */}
      <a
        href="#demo"
        aria-label="Try live demo"
        className="demo-cta absolute bottom-7 left-1/2 -translate-x-1/2 z-10 w-[124px] h-[124px] rounded-full bg-jb-red text-white flex flex-col items-center justify-center text-center text-[17px] leading-tight hover:bg-jb-red-dark transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-jb-red"
      >
        <span>
          Try live
          <br />
          demo
        </span>
        <svg
          className="demo-cta-arrow mt-1"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </a>
    </section>
  );
}
